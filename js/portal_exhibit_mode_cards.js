/* Normal game ONLY: render the already-tested exhibition mode cards.
 * The exhibition's shared portal JS, title markup, game and PWA are not modified.
 * The existing normal-game buttons and attached event listeners remain in place.
 */
(() => {
  'use strict';
  const path = window.location.pathname || '';
  if (path.includes('/exhibit/')) return;
  const picker = document.getElementById('portalEvolutionModes');
  const list = picker?.querySelector('.portal-experiment-list');
  if (!list || list.dataset.normalExhibitCards === '1') return;

  const designs = [
    ['portalCrypticMode', 'portal-experiment-cryptic',
      '01 / CRYPTIC', '隠れるギタイ', '隠蔽擬態',
      'gitailab_thumbnail_hide_960x300.webp',
      '白い蛾が葉に似た緑色へ変化する様子'],
    ['portalWarningMode', 'portal-experiment-warning',
      '02 / WARNING', '目立つギタイ', '警告色の進化とベイツ型擬態',
      'gitailab_thumbnail_warning_960x300.webp',
      '白い蛾が鮮やかな赤い警告模様へ変化する様子']
  ];
  const buttons = designs.map(design => document.getElementById(design[0]));
  if (buttons.some(button => !button)) return;

  const lead = document.createElement('p');
  lead.className = 'portal-experiment-lead';
  lead.textContent = '蛾を捕食すると、生き残った個体が次の世代の親になります。';
  list.insertAdjacentElement('beforebegin', lead);

  // Only fixed, source-controlled text and WebP filenames enter the DOM.
  // No stored nicknames/genomes/URLs are interpolated here.
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  for (let i = 0; i < designs.length; i += 1) {
    const [id, style, number, title, subtitle, banner, alt] = designs[i];
    const button = buttons[i];
    button.classList.add(style);
    const index = element('span', 'portal-experiment-index', number);
    const heading = element('strong', '', title);
    const subheading = element('span', 'portal-experiment-subtitle', subtitle);
    const image = element('img', 'portal-experiment-thumbnail');
    image.src = 'img/modeselect/' + banner;
    image.width = 960;
    image.height = 300;
    image.alt = alt;
    image.decoding = 'async';
    const action = element('span', 'portal-experiment-action', '実験開始 ▶');
    action.setAttribute('aria-hidden', 'true');
    button.replaceChildren(index, heading, subheading, image, action);
  }
  list.dataset.normalExhibitCards = '1';
})();
