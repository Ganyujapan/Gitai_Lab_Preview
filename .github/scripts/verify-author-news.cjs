// Regression protection for author's exact copy and the fixed mode-menu footer.
// The editorial text must remain unchanged, including game/simulator word choice.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const manuscript = fs.readFileSync('author_news_source.txt', 'utf8').trimEnd();
const article = fs.readFileSync('author_news.html', 'utf8');
const game = fs.readFileSync('index.html', 'utf8');
const menuCss = fs.readFileSync('css/author_news_link.css', 'utf8');
const articleCss = fs.readFileSync('css/author_news.css', 'utf8');
const htmlEncode = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const lines = manuscript.split(/\r?\n/).filter(Boolean);
let last = -1;
for (const line of lines) {
  // Markdown source hyperlink is intentionally rendered as an HTML anchor.
  // Only the two standalone headings intentionally omit their outer 「」.
  const heading = line === '「なぜギタイラボを作ろうと思ったのか。作者からのおしらせ。」'
    || line === '「進化に目的はない。」';
  const visible = heading ? htmlEncode(line.slice(1, -1))
    : line.startsWith('[『光と闇の生き物図鑑』について詳しく見る](')
      ? '『光と闇の生き物図鑑』について詳しく見る' : htmlEncode(line);
  const at = article.indexOf(visible, last + 1);
  assert.ok(at > last, 'Missing or altered text, or changed order: ' + line);
  last = at;
}
assert.match(article,/https:\/\/www\.kadokawa\.co\.jp\/product\/322507000205\//);
assert.match(article,/https:\/\/x\.com\/gitailab/);
assert.match(article,/https:\/\/x\.com\/ganyujapan/);
assert.match(article,/<h1 class="author-title">なぜギタイラボを作ろうと思ったのか。作者からのおしらせ。<\/h1>/);
assert.match(article,/<h2 class="author-statement">進化に目的はない。<\/h2>/);
assert.doesNotMatch(articleCss,/border-left:\s*3px solid/);
assert.match(articleCss,/aspect-ratio:\s*665\s*\/\s*900/);
const crypto = require('node:crypto');
// Assert that all four source images are included byte-for-byte as supplied.
for (const [file, sha] of [
  ['img/author/akebi_konoha.jpg', '4b82dd5d44bf4846ddade62ca94a7716c984d385'],
  ['img/author/book_hikari_to_yami.jpg', 'f4449a8d4504b16bf140fa582a850529bf894b55'],
  ['img/author/x_gitailab.png', '4c6c6802b569e92318acbe2682a566530ea97f25'],
  ['img/author/x_ganyujapan.png', '49a0141a2004b527a5e03d2bce323c48d074365e']
]) {
  const data = fs.readFileSync(file);
  const gitBlobSha = crypto.createHash('sha1').update('blob ' + data.length + '\\0')
    .update(data).digest('hex');
  assert.equal(gitBlobSha, sha, 'Original uploaded image bytes changed: ' + file);
  assert.ok(article.includes('src="' + file + '"'), 'Missing image in article: ' + file);
}
assert.equal((article.match(/class="author-x-icon"/g)||[]).length, 2);
assert.match(article,/href="\.\/\?portal=menu"/);
const menu = game.match(/<div id="portalMenu"[\s\S]*?<div class="portal-menu-footer">/);
assert.ok(menu, 'Mode-selection menu missing');
const listEnd = menu[0].indexOf('</div>\n        </div>\n        <div class="portal-author-news">');
assert.ok(listEnd > 0, 'Author link must be outside scrollable menu content');
assert.match(menu[0],/<a id="portalAuthorNews" href="author_news\.html">/);
assert.match(menuCss,/\.portal-menu \.portal-modes\s*\{[\s\S]*?overflow-y:\s*auto/);
assert.match(menuCss,/\.portal-menu \.portal-menu-content\s*\{[\s\S]*?min-height:\s*0/);
assert.match(menuCss,/\.portal-menu\s*\{[\s\S]*?safe-area-inset-bottom/);
assert.match(menuCss,/\.portal-menu \.portal-author-news\s*\{[\s\S]*?flex:\s*0 0 auto/);
assert.match(articleCss,/env\(safe-area-inset-top\)/);
assert.match(articleCss,/env\(safe-area-inset-bottom\)/);
console.log('Author copy (exact source lines), image slots, menu footer, and safe areas: OK');
