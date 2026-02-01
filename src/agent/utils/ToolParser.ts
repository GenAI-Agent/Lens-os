/**
 * Tool Parser - Parse <tool>...</tool> blocks from LLM output
 */

import type { ToolCall } from '../../core/types';

export class ToolParser {
  private buffer: string = '';
  private inToolBlock: boolean = false;
  private toolBuffer: string = '';

  /**
   * Add a chunk and return parsed text and tool calls
   */
  addChunk(chunk: string): { text: string; toolCalls: ToolCall[] | null } {
    this.buffer += chunk;

    let text = '';
    const toolCalls: ToolCall[] = [];

    while (this.buffer.length > 0) {
      if (!this.inToolBlock) {
        const toolStart = this.buffer.indexOf('<tool>');

        if (toolStart === -1) {
          // No tool tag, output all but last few chars (in case of partial tag)
          if (this.buffer.length > 6) {
            text += this.buffer.slice(0, -6);
            this.buffer = this.buffer.slice(-6);
          }
          break;
        } else {
          // Found tool start
          text += this.buffer.slice(0, toolStart);
          this.buffer = this.buffer.slice(toolStart + 6);
          this.inToolBlock = true;
          this.toolBuffer = '';
        }
      } else {
        // 在 tool block 中，需要在 toolBuffer + buffer 的組合中找 </tool>
        // 因為 </tool> 可能被分割成多個 chunk
        this.toolBuffer += this.buffer;
        this.buffer = '';

        const toolEnd = this.toolBuffer.indexOf('</tool>');

        if (toolEnd === -1) {
          // Still in tool block, keep accumulating
          break;
        } else {
          // Found tool end in combined buffer
          const toolContent = this.toolBuffer.slice(0, toolEnd);
          const afterTool = this.toolBuffer.slice(toolEnd + 7);
          this.toolBuffer = '';
          this.buffer = afterTool; // 把 </tool> 後的內容放回 buffer
          this.inToolBlock = false;

          // Parse tool call
          const toolCall = this.parseToolContent(toolContent);
          if (toolCall) {
            toolCalls.push(toolCall);
          }
        }
      }
    }

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
    };
  }

  /**
   * Flush remaining buffer
   */
  flush(): string {
    const remaining = this.buffer;
    this.buffer = '';
    this.inToolBlock = false;
    this.toolBuffer = '';
    return remaining;
  }

  /**
   * Parse tool content
   */
  private parseToolContent(content: string): ToolCall | null {
    try {
      const nameMatch = content.match(/name:\s*(.+?)(?:\n|$)/);
      const paramsMatch = content.match(/parameters:\s*(\{[\s\S]*\})/);

      if (!nameMatch) return null;

      const name = nameMatch[1].trim();
      let parameters: Record<string, any> = {};

      if (paramsMatch) {
        try {
          parameters = JSON.parse(paramsMatch[1].trim());
        } catch {
          parameters = { raw: paramsMatch[1] };
        }
      }

      return { name, parameters };
    } catch {
      return null;
    }
  }
}
