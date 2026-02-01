/**
 * WebUse Tool - DOM operations (click, scroll, etc.)
 */

type WebUseAction = 'click' | 'doubleClick' | 'scroll' | 'scrollToElement' | 'highlight' | 'drag' | 'deepCrawl' | 'navigate';

interface WebUseParams {
  action: WebUseAction;
  selector?: string;
  x?: number;
  y?: number;
  text?: string;
  url?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;
}

export class WebUseTool {
  private onWidgetAction: (action: string, params: any) => Promise<any>;

  constructor(onWidgetAction: (action: string, params: any) => Promise<any>) {
    this.onWidgetAction = onWidgetAction;
  }

  async execute(params: WebUseParams): Promise<any> {
    const { action, selector, x, y, text, url, direction, amount } = params;

    try {
      switch (action) {
        case 'click':
          return this.click({ selector, x, y });
        case 'doubleClick':
          return this.doubleClick({ selector, x, y });
        case 'scroll':
          return this.scroll({ direction, amount });
        case 'scrollToElement':
          if (!selector) {
            return { success: false, error: 'selector is required' };
          }
          return this.scrollToElement({ selector });
        case 'highlight':
          if (!selector) {
            return { success: false, error: 'selector is required' };
          }
          return this.highlight({ selector });
        case 'navigate':
          if (!url) {
            return { success: false, error: 'url is required' };
          }
          return this.navigate({ url });
        default:
          return this.onWidgetAction(action, params);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Action failed',
      };
    }
  }

  private async click(params: { selector?: string; x?: number; y?: number }): Promise<any> {
    if (params.selector) {
      const element = document.querySelector(params.selector) as HTMLElement;
      if (element) {
        element.click();
        return { success: true, action: 'click', selector: params.selector };
      }
      return { success: false, error: `Element not found: ${params.selector}` };
    }

    if (params.x !== undefined && params.y !== undefined) {
      const element = document.elementFromPoint(params.x, params.y) as HTMLElement;
      if (element) {
        element.click();
        return { success: true, action: 'click', x: params.x, y: params.y };
      }
    }

    return { success: false, error: 'No selector or coordinates provided' };
  }

  private async doubleClick(params: { selector?: string; x?: number; y?: number }): Promise<any> {
    if (params.selector) {
      const element = document.querySelector(params.selector) as HTMLElement;
      if (element) {
        element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        return { success: true, action: 'doubleClick', selector: params.selector };
      }
    }
    return { success: false, error: 'Element not found' };
  }

  private async scroll(params: { direction?: string; amount?: number }): Promise<any> {
    const amount = params.amount || 300;
    const direction = params.direction || 'down';

    const scrollOptions: Record<string, [number, number]> = {
      up: [0, -amount],
      down: [0, amount],
      left: [-amount, 0],
      right: [amount, 0],
    };

    const [x, y] = scrollOptions[direction] || [0, amount];
    window.scrollBy({ left: x, top: y, behavior: 'smooth' });

    return { success: true, action: 'scroll', direction, amount };
  }

  private async scrollToElement(params: { selector: string }): Promise<any> {
    const element = document.querySelector(params.selector);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return { success: true, action: 'scrollToElement', selector: params.selector };
    }
    return { success: false, error: `Element not found: ${params.selector}` };
  }

  private async highlight(params: { selector: string }): Promise<any> {
    const element = document.querySelector(params.selector) as HTMLElement;
    if (element) {
      const originalOutline = element.style.outline;
      element.style.outline = '3px solid #ff6b6b';
      setTimeout(() => {
        element.style.outline = originalOutline;
      }, 2000);
      return { success: true, action: 'highlight', selector: params.selector };
    }
    return { success: false, error: `Element not found: ${params.selector}` };
  }

  private async navigate(params: { url: string }): Promise<any> {
    if (typeof window !== 'undefined') {
      window.location.href = params.url;
      return { success: true, action: 'navigate', url: params.url };
    }
    return { success: false, error: 'Window not available' };
  }
}
