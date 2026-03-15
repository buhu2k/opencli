import { cli, Strategy } from '../../registry.js';

cli({
  site: 'twitter',
  name: 'timeline',
  description: 'Twitter Home Timeline',
  domain: 'x.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 20 },
  ],
  columns: ['responseType', 'first'],
  func: async (page, kwargs) => {
    await page.goto('https://x.com/home');
    await page.wait(5);
    // Inject the fetch interceptor manually to see exactly what happens
    await page.evaluate(`
      () => {
        window.__intercept_data = [];
        const origFetch = window.fetch;
        window.fetch = async function(...args) {
          let u = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
          const res = await origFetch.apply(this, args);
          setTimeout(async () => {
            try {
              if (u.includes('HomeTimeline')) {
                const clone = res.clone();
                const j = await clone.json();
                window.__intercept_data.push(j);
              }
            } catch(e) {}
          }, 0);
          return res;
        };
      }
    `);
    
    // trigger scroll
    for(let i=0; i<3; i++) {
      await page.evaluate('() => window.scrollTo(0, document.body.scrollHeight)');
      await page.wait(2);
    }
    
    // extract
    const data = await page.evaluate('() => window.__intercept_data');
    if (!data || data.length === 0) return [{responseType: 'no data captured'}];
    
    return [{responseType: `captured ${data.length} responses`, first: JSON.stringify(data[0]).substring(0,300)}];
  }
});
