import { cli, Strategy } from '../../registry.js';

cli({
  site: 'xiaohongshu',
  name: 'user',
  description: 'Get user notes from Xiaohongshu',
  domain: 'xiaohongshu.com',
  strategy: Strategy.INTERCEPT,
  browser: true,
  args: [
    { name: 'id', type: 'string', required: true },
    { name: 'limit', type: 'int', default: 15 },
  ],
  columns: ['id', 'title', 'type', 'likes', 'url'],
  func: async (page, kwargs) => {
    await page.goto(`https://www.xiaohongshu.com/user/profile/${kwargs.id}`);
    await page.wait(5);

    await page.evaluate(`
      () => {
        window.__opencli_xhr = [];
        if (!window.__patched_xhr) {
          const origFetch = window.fetch;
          window.fetch = async function(...args) {
            let u = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
            const res = await origFetch.apply(this, args);
            setTimeout(async () => {
              try {
                if (u.includes('v1/user/posted')) {
                  const clone = res.clone();
                  const j = await clone.json();
                  window.__opencli_xhr.push({url: u, data: j});
                }
              } catch(e) {}
            }, 0);
            return res;
          };
          
          const XHR = XMLHttpRequest.prototype;
          const open = XHR.open;
          const send = XHR.send;
          XHR.open = function(method, url) {
            this._url = url;
            return open.call(this, method, url, ...Array.prototype.slice.call(arguments, 2));
          };
          XHR.send = function() {
            this.addEventListener('load', function() {
              if(this._url.includes('v1/user/posted')) {
                try { window.__opencli_xhr.push({url: this._url, data: JSON.parse(this.responseText)}); } catch(e){}
              }
            });
            return send.apply(this, arguments);
          };
          window.__patched_xhr = true;
        }
      }
    `);

    // Trigger API by scrolling
    for (let i = 0; i < 2; i++) {
        await page.evaluate('() => window.scrollTo(0, document.body.scrollHeight)');
        await page.wait(2);
    }
    
    // Retrieve data
    const requests = await page.evaluate('() => window.__opencli_xhr');
    if (!requests || requests.length === 0) return [];

    let results: any[] = [];
    for (const req of requests) {
      if (req.data && req.data.data && req.data.data.notes) {
         for (const note of req.data.data.notes) {
           results.push({
             id: note.note_id || note.id,
             title: note.display_title || '',
             type: note.type || '',
             likes: note.interact_info?.liked_count || '0',
             url: `https://www.xiaohongshu.com/explore/${note.note_id || note.id}`
           });
         }
      }
    }

    return results.slice(0, kwargs.limit);
  }
});
