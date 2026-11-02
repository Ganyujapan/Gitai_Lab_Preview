'use strict';
// Parse the ACTUAL AAC M4A bundled into the offline PWA. CI intentionally
// uses only Node: no external ffmpeg/ffprobe installation or downloads.
// A valid source file is NOT proof of correct Safari / WebKit looping.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const site=process.argv[2]||'_site';
const name='audio/gitailab_rainforest_ios_seamless_loop_48k.m4a';
const file=fs.readFileSync(path.join(site,'exhibit',name));
const source=fs.readFileSync(path.join(site,name));
assert.deepEqual(file,source,'exhibit and source AAC must be identical');
const manifest=JSON.parse(fs.readFileSync(path.join(site,'exhibit/precache.json'),'utf8'));
assert.ok(manifest.includes(name),'iOS AAC must be offline-precached');
assert.ok(file.length>100000 && file.length<2000000);
function u32(i){assert.ok(i>=0&&i+4<=file.length);return file.readUInt32BE(i);}
function boxes(from,to){
 const result=[];
 let at=from;
 while(at+8<=to){
   let size=u32(at),offset=8;
   const type=file.toString('ascii',at+4,at+8);
   if(size===1){
     assert.ok(at+16<=to);
     size=Number(file.readBigUInt64BE(at+8));offset=16;
   }
   if(size===0)size=to-at;
   assert.ok(size>=offset && at+size<=to,'invalid MP4 '+type+' box');
   result.push({type,start:at,end:at+size,data:at+offset,size});
   at+=size;
 }
 assert.equal(at,to,'unparsed trailing MP4 atoms');
 return result;
}
function one(nodes,type){
 const b=nodes.filter(x=>x.type===type);
 assert.equal(b.length,1,'expected exactly one '+type+' box');
 return b[0];
}
function children(parent){return boxes(parent.data,parent.end);}
const outer=boxes(0,file.length);
assert.equal(one(outer,'ftyp').type,'ftyp');
const mediaData=one(outer,'mdat');
const moov=one(outer,'moov');
const tracks=children(moov).filter(b=>b.type==='trak');
assert.equal(tracks.length,1,'one self-contained iOS audio track only');
const mdia=one(children(tracks[0]),'mdia');
const sub=children(mdia);
const hdlr=one(sub,'hdlr');
assert.equal(file.toString('ascii',hdlr.data+8,hdlr.data+12),'soun',
 'one audio track, not a video or non-audio track');
const mdhd=one(sub,'mdhd');
const mdhdVersion=file[mdhd.data];
assert.ok(mdhdVersion===0||mdhdVersion===1);
const scale=u32(mdhd.data+(mdhdVersion===0?12:20));
assert.ok(scale>0);
const stbl=one(children(one(children(mdia),'minf')),'stbl');
const tables=children(stbl);
const stsd=one(tables,'stsd');
assert.equal(u32(stsd.data+4),1,'one sample description');
const entry=stsd.data+8;
const entrySize=u32(entry);
assert.ok(entrySize>=36 && entry+entrySize<=stsd.end);
assert.equal(file.toString('ascii',entry+4,entry+8),'mp4a');
const channels=file.readUInt16BE(entry+8+16);
const sampleRate=u32(entry+8+24)>>>16;
assert.equal(channels,1,'mono');
assert.equal(sampleRate,48000,'48kHz AAC');
const stts=one(tables,'stts');
const timeEntries=u32(stts.data+4);
assert.ok(timeEntries>0 && timeEntries<10000);
let countFromTimes=0,mediaTicks=0;
for(let i=0;i<timeEntries;i++){
 const count=u32(stts.data+8+i*8);
 const delta=u32(stts.data+12+i*8);
 assert.ok(count>0 && delta>0,'all AAC packet decode deltas must be positive');
 countFromTimes+=count;
 mediaTicks+=count*delta;
}
const duration=mediaTicks/scale;
assert.ok(duration>40&&duration<48,'one full-length approx. 45s AAC track');
const stsz=one(tables,'stsz');
const fixedSampleSize=u32(stsz.data+4);
const samples=u32(stsz.data+8);
assert.ok(samples>1600 && samples<4000,'expected full 45s AAC packet count');
assert.equal(samples,countFromTimes,'packet counts agree between stts and stsz');
const sizes=Array.from({length:samples},(_,i)=>
 fixedSampleSize || u32(stsz.data+12+i*4));
assert.ok(sizes.every(x=>x>0&&x<65536),'positive bounded AAC packet sizes');
const stsc=one(tables,'stsc'),chunksCount=u32(stsc.data+4),chunking=[];
assert.ok(chunksCount>0&&chunksCount<samples);
for(let i=0;i<chunksCount;i++){
 chunking.push({first:u32(stsc.data+8+i*12),count:u32(stsc.data+12+i*12)});
}
const offsetsBox=tables.find(x=>x.type==='stco'||x.type==='co64');
assert.ok(offsetsBox,'AAC chunk offsets required');
const offsetCount=u32(offsetsBox.data+4);
assert.ok(offsetCount>0&&offsetCount<samples+1);
const offsets=Array.from({length:offsetCount},(_,i)=>
 offsetsBox.type==='stco' ? u32(offsetsBox.data+8+i*4)
 : Number(file.readBigUInt64BE(offsetsBox.data+8+i*8)));
let sampleIndex=0, totalCompressedBytes=0;
const fourSecondHashes=[];
let fourSecBytes=[];
let segment=0;
let audioTicks=0;
let tickEntry=0,usedInEntry=0;
for(let chunk=1;chunk<=offsetCount;chunk++){
 const map=[...chunking].reverse().find(e=>e.first<=chunk);
 assert.ok(map,'missing AAC sample-to-chunk mapping');
 let at=offsets[chunk-1];
 for(let j=0;j<map.count;j++){
   assert.ok(sampleIndex<samples,'too many audio packets in stsc mapping');
   const size=sizes[sampleIndex++];
   assert.ok(at>=mediaData.data && at+size<=mediaData.end,'sample lies inside mdat');
   // Bucket the ACTUAL compressed AAC frames by their timestamp, not
   // an approximate byte-rate slice of the entire file.
   while(tickEntry<timeEntries && usedInEntry>=u32(stts.data+8+tickEntry*8)){
     tickEntry++;usedInEntry=0;
   }
   assert.ok(tickEntry<timeEntries);
   const fourSec=Math.floor(audioTicks/scale/4);
   if(fourSec!==segment){
     fourSecondHashes.push(crypto.createHash('sha256')
       .update(Buffer.concat(fourSecBytes)).digest('hex'));
     fourSecBytes=[];segment=fourSec;
   }
   fourSecBytes.push(file.subarray(at,at+size));
   totalCompressedBytes+=size;
   const delta=u32(stts.data+12+tickEntry*8);
   audioTicks+=delta;
   usedInEntry++;
   at+=size;
 }
}
if(fourSecBytes.length)fourSecondHashes.push(crypto.createHash('sha256')
 .update(Buffer.concat(fourSecBytes)).digest('hex'));
assert.equal(sampleIndex,samples);
assert.ok(totalCompressedBytes>100000,'no empty/placeholder audio stream');
const unique=new Set(fourSecondHashes);
assert.ok(fourSecondHashes.length>=10 && unique.size>=9,
 'M4A itself may contain a repeated identical four-second compressed clip');
assert.ok(Math.abs(audioTicks/scale-duration)<0.01);
console.log('AAC structural audit: '+JSON.stringify({
 codec:'AAC/mp4a',sample_rate:sampleRate,channels,mp4_duration_s:+duration.toFixed(3),
 packets:samples,decode_time_entries:timeEntries,chunk_offsets:offsetCount,
 monotonic_media_clock:true,four_second_windows:fourSecondHashes.length,
 unique_four_second_windows:unique.size,compressed_audio_bytes:totalCompressedBytes
}));
console.log('Limit: this inspects AAC frame layout and timing, not audible decoding or iOS WebKit session behavior.');
