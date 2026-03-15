import { cli, Strategy } from '../../registry.js';

cli({
  site: 'twitter',
  name: 'search',
  description: 'Search Twitter/X for tweets',
  domain: 'x.com',
  strategy: Strategy.INTERCEPT, // Use intercept strategy
  browser: true,
  args: [
    { name: 'query', type: 'string', required: true },
    { name: 'limit', type: 'int', default: 15 },
  ],
  columns: ['id', 'author', 'text', 'likes', 'views', 'url'],
  func: async (page, kwargs) => {
    // 1. Navigate to the search page
    const q = encodeURIComponent(kwargs.query);
    await page.goto(`https://x.com/search?q=${q}&f=top`);
    await page.wait(5);

    // 2. Inject XHR interceptor
    await page.evaluate(`
      () => {
        window.__opencli_xhr = [];
        if (!window.__patched_xhr) {
          const XHR = XMLHttpRequest.prototype;
          const open = XHR.open;
          const send = XHR.send;
          XHR.open = function(method, url) {
            this._url = url;
            return open.call(this, method, url, ...Array.prototype.slice.call(arguments, 2));
          };
          XHR.send = function() {
            this.addEventListener('load', function() {
              if(this._url.includes('SearchTimeline')) {
                try { window.__opencli_xhr.push({url: this._url, data: JSON.parse(this.responseText)}); } catch(e){}
              }
            });
            return send.apply(this, arguments);
          };
          window.__patched_xhr = true;
        }
      }
    `);

    // 3. Trigger API by scrolling
    for (let i = 0; i < 3; i++) {
        await page.evaluate('() => window.scrollTo(0, document.body.scrollHeight)');
        await page.wait(2);
    }
    
    // 4. Retrieve data
    const requests = await page.evaluate('() => window.__opencli_xhr');
    if (!requests || requests.length === 0) return [];

    let results: any[] = [];
    for (const req of requests) {
      try {
        const insts = req.data.data.search_by_raw_query.search_timeline.timeline.instructions;
        const addEntries = insts.find((i: any) => i.type === 'TimelineAddEntries');
        if (!addEntries) continue;

        for (const entry of addEntries.entries) {
          if (!entry.entryId.startsWith('tweet-')) continue;
          
          let tweet = entry.content?.itemContent?.tweet_results?.result;
          if (!tweet) continue;

          // Handle retweet wrapping
          if (tweet.__typename === 'TweetWithVisibilityResults' && tweet.tweet) {
              tweet = tweet.tweet;
          }

          results.push({
            id: tweet.rest_id,
            author: tweet.core?.user_results?.result?.legacy?.screen_name || 'unknown',
            text: tweet.legacy?.full_text || '',
            likes: tweet.legacy?.favorite_count || 0,
            views: tweet.views?.count || '0',
            url: `https://x.com/i/status/${tweet.rest_id}`
          });
        }
      } catch (e) {
        // ignore parsing errors for individual payloads
      }
    }

    return results.slice(0, kwargs.limit);
  }
});
