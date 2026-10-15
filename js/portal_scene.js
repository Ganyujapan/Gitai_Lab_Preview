/* Swap independent SVGs in img/portal or adjust positions and speed below.
 x,y: viewport percent; w: viewport width percent; max: maximum px;
 depth: pointer parallax; drift: animation seconds; phase: timing offset.
 */
window.GitaiPortalScene = Object.freeze([
 {id:'halo',asset:'halo.svg',x:50,y:54,w:100,max:700,depth:.4,drift:60,phase:0,z:0,kind:'halo'},
 {id:'right-branch',asset:'branch.svg',x:98,y:44,w:66,max:650,depth:.9,drift:17,phase:-3,z:1,kind:'branch'},
 {id:'left-fern',asset:'fern.svg',x:4,y:72,w:48,max:390,depth:1.1,drift:13,phase:-2,z:2,kind:'fern'},
 {id:'main-moth',asset:'moth.svg',x:50,y:54,w:75,max:520,depth:1.6,drift:8,phase:0,z:3,kind:'moth'},
 {id:'leaf-upper',asset:'leaf.svg',x:16,y:32,w:20,max:175,depth:2.1,drift:12,phase:-4,z:4,kind:'leaf',spin:-24},
 {id:'leaf-right',asset:'leaf.svg',x:84,y:69,w:24,max:205,depth:2.7,drift:10,phase:-2,z:4,kind:'leaf',spin:38},
 {id:'leaf-low',asset:'leaf.svg',x:19,y:84,w:13,max:120,depth:3,drift:11,phase:-7,z:4,kind:'leaf',spin:86},
 {id:'seed-left',asset:'seed.svg',x:28,y:61,w:12,max:86,depth:2,drift:9,phase:-4,z:5,kind:'seed',spin:-16},
 {id:'seed-right',asset:'seed.svg',x:77,y:31,w:10,max:75,depth:2.8,drift:8,phase:-1,z:5,kind:'seed',spin:21}
]);