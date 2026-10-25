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
  const visible = line.startsWith('[『光と闇の生き物図鑑』について詳しく見る](')
    ? '『光と闇の生き物図鑑』について詳しく見る' : htmlEncode(line);
  const at = article.indexOf(visible, last + 1);
  assert.ok(at > last, 'Missing or altered text, or changed order: ' + line);
  last = at;
}
assert.match(article,/https:\/\/www\.kadokawa\.co\.jp\/product\/322507000205\//);
assert.match(article,/https:\/\/x\.com\/gitailab/);
assert.match(article,/https:\/\/x\.com\/ganyujapan/);
assert.match(article,/<h2 class="author-statement">「進化に目的はない。」<\/h2>/);
assert.match(article,/author-placeholder-landscape/);
assert.match(article,/author-placeholder-cover/);
assert.equal((article.match(/<span class="author-placeholder author-placeholder-icon"/g)||[]).length,2);
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
