// Adds the right-click menu items and opens a small result window when one is used.

const MENUS = [
  { id: 'check-image', title: 'Is this AI? Check image', contexts: ['image'] },
  { id: 'check-video', title: 'Is this AI? Check video', contexts: ['video'] },
  { id: 'check-text', title: 'Is this AI? Check selected text', contexts: ['selection'] },
  { id: 'check-link', title: 'Is this AI? Check linked file', contexts: ['link'] },
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const m of MENUS) chrome.contextMenus.create(m);
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const job = {
    menu: info.menuItemId,
    srcUrl: info.menuItemId === 'check-link' ? info.linkUrl : info.srcUrl,
    text: info.selectionText,
    pageUrl: info.pageUrl || tab?.url,
    at: Date.now(),
  };
  const id = crypto.randomUUID();
  await chrome.storage.session.set({ [`job:${id}`]: job });
  await chrome.windows.create({
    url: chrome.runtime.getURL(`result.html?job=${id}`),
    type: 'popup',
    width: 460,
    height: 680,
  });
});
