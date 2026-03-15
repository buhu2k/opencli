/**
 * Pipeline step: intercept — declarative XHR interception.
 */

import type { IPage } from '../../types.js';
import { render } from '../template.js';

export async function stepIntercept(page: IPage, params: any, data: any, args: Record<string, any>): Promise<any> {
  const cfg = typeof params === 'object' ? params : {};
  const trigger = cfg.trigger ?? '';
  const capturePattern = cfg.capture ?? '';
  const timeout = cfg.timeout ?? 8;
  const selectPath = cfg.select ?? null;

  if (!capturePattern) return data;

  // Step 1: Inject fetch/XHR interceptor BEFORE trigger
  await page.evaluate(`
    () => {
      window.__opencli_intercepted = window.__opencli_intercepted || [];
      const pattern = ${JSON.stringify(capturePattern)};
      
      if (!window.__opencli_fetch_patched) {
        const origFetch = window.fetch;
        window.fetch = async function(...args) {
          const reqUrl = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
          const response = await origFetch.apply(this, args);
          setTimeout(async () => {
            try {
              if (reqUrl.includes(pattern)) {
                const clone = response.clone();
                const json = await clone.json();
                window.__opencli_intercepted.push(json);
              }
            } catch(e) {}
          }, 0);
          return response;
        };
        window.__opencli_fetch_patched = true;
      }

      if (!window.__opencli_xhr_patched) {
        const XHR = XMLHttpRequest.prototype;
        const open = XHR.open;
        const send = XHR.send;
        XHR.open = function(method, url, ...args) {
          this._reqUrl = url;
          return open.call(this, method, url, ...args);
        };
        XHR.send = function(...args) {
          this.addEventListener('load', function() {
            try {
              if (this._reqUrl && this._reqUrl.includes(pattern)) {
                window.__opencli_intercepted.push(JSON.parse(this.responseText));
              }
            } catch(e) {}
          });
          return send.apply(this, args);
        };
        window.__opencli_xhr_patched = true;
      }
    }
  `);

  // Step 2: Execute the trigger action
  if (trigger.startsWith('navigate:')) {
    const url = render(trigger.slice('navigate:'.length), { args, data });
    await page.goto(String(url));
  } else if (trigger.startsWith('evaluate:')) {
    const js = trigger.slice('evaluate:'.length);
    const { normalizeEvaluateSource } = await import('../template.js');
    await page.evaluate(normalizeEvaluateSource(render(js, { args, data }) as string));
  } else if (trigger.startsWith('click:')) {
    const ref = render(trigger.slice('click:'.length), { args, data });
    await page.click(String(ref).replace(/^@/, ''));
  } else if (trigger === 'scroll') {
    await page.scroll('down');
  }

  // Step 3: Wait a bit for network requests to fire
  await page.wait(Math.min(timeout, 3));

  // Step 4: Retrieve captured data
  const matchingResponses = await page.evaluate(`
    () => {
      const data = window.__opencli_intercepted || [];
      window.__opencli_intercepted = []; // clear after reading
      return data;
    }
  `);


  // Step 4: Select from response if specified
  let result = matchingResponses.length === 1 ? matchingResponses[0] :
               matchingResponses.length > 1 ? matchingResponses : data;

  if (selectPath && result) {
    let current = result;
    for (const part of String(selectPath).split('.')) {
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        current = current[part];
      } else break;
    }
    result = current ?? result;
  }

  return result;
}
