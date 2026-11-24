// Browser panel drawings (24px grid, currentColor). Bundled and hot reloaded with the panel.
const svg = (body: string, fill = false) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icons = {
  back: svg("<path d='M15 18l-6-6 6-6'/>"),
  forward: svg("<path d='M9 18l6-6-6-6'/>"),
  reload: svg("<path d='M20 11a8 8 0 1 0-2.3 5.7'/><path d='M20 4v7h-7'/>"),
  stop: svg("<path d='M6 6l12 12M18 6 6 18'/>"),
  plus: svg("<path d='M12 5v14M5 12h14'/>"),
  close: svg("<path d='M7 7l10 10M17 7 7 17'/>"),
  power: svg("<path d='M12 3v9'/><path d='M6.3 7.3a8 8 0 1 0 11.4 0'/>"),
  play: svg("<path d='M7 5l12 7-12 7z'/>"),
  network: svg("<path d='M4 18h3l2-7 3 10 3-14 2 11h3'/>"),
  settings: svg("<circle cx='12' cy='12' r='3'/><path d='M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'/>"),
  fit: svg("<path d='M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'/>"),
  agent: svg("<rect x='5' y='8' width='14' height='11' rx='3'/><path d='M12 4v4M9 13h.01M15 13h.01'/>"),
  trash: svg("<path d='M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'/>"),
  globe: svg("<circle cx='12' cy='12' r='9'/><path d='M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z'/>"),
  /** Agent pointer overlay drawn natively over the live preview. */
  pointer: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 2.5 19.5 12l-7 1.6-3.4 6.9z" fill="currentColor"/></svg>`,
};
