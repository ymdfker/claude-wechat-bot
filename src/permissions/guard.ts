import { loadConfig, updateConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionMode = "default" | "accept_edits" | "yolo";

export interface ToolCallRequest {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ApprovalDecision =
  | { approved: true }
  | { approved: false; reason: string };

// ---------------------------------------------------------------------------
// Permission Guard
// ---------------------------------------------------------------------------

export class PermissionGuard {
  private mode: PermissionMode;
  private allowedTools: Set<string> = new Set();
  /** Pending tool calls awaiting user approval. Map<toolUseId, {resolve, reject}> */
  private pendingApprovals = new Map<
    string,
    {
      resolve: (approved: boolean) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor() {
    this.mode = loadConfig().permissionMode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
    updateConfig({ permissionMode: mode });
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  allowTool(name: string): void {
    this.allowedTools.add(name);
  }

  disallowTool(name: string): void {
    this.allowedTools.delete(name);
  }

  listAllowed(): string[] {
    return [...this.allowedTools];
  }

  /** Synchronous check: is this tool call auto-approved? */
  checkAutoApproval(toolCall: ToolCallRequest): ApprovalDecision {
    // YOLO mode: everything auto-approved
    if (this.mode === "yolo") {
      return { approved: true };
    }

    // Pre-approved tools list
    if (this.allowedTools.has(toolCall.name)) {
      return { approved: true };
    }

    // accept_edits mode: auto-approve file operations
    if (this.mode === "accept_edits" && isEditTool(toolCall.name)) {
      return { approved: true };
    }

    // default mode: everything needs approval
    return { approved: false, reason: `Tool "${toolCall.name}" requires approval. Mode: ${this.mode}` };
  }

  /** Check if a tool call needs user interaction. Returns the decision directly if auto-approved, or registers a pending approval. */
  needsApproval(toolCall: ToolCallRequest): ApprovalDecision {
    return this.checkAutoApproval(toolCall);
  }

  /** Register a pending approval and wait for user decision (with timeout). */
  async waitForApproval(
    toolCall: ToolCallRequest,
    timeoutMs = 120_000,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(toolCall.id);
        resolve(false); // timeout = reject
      }, timeoutMs);

      this.pendingApprovals.set(toolCall.id, { resolve, timeout });
    });
  }

  /** Called when user sends "allow" or "reject" for a pending tool call. */
  resolveApproval(toolUseId: string, approved: boolean): boolean {
    const pending = this.pendingApprovals.get(toolUseId);
    if (!pending) return false;
    clearTimeout(pending.timeout);
    this.pendingApprovals.delete(toolUseId);
    pending.resolve(approved);
    return true;
  }

  getPendingApprovals(): string[] {
    return [...this.pendingApprovals.keys()];
  }

  /** Format a tool call for display to the user. */
  formatToolCallForApproval(toolCall: ToolCallRequest): string {
    const inputPreview = JSON.stringify(toolCall.input, null, 2);
    const truncated =
      inputPreview.length > 300
        ? inputPreview.slice(0, 300) + "..."
        : inputPreview;

    return [
      `🔧 Claude 想使用工具: **${toolCall.name}**`,
      `\`\`\`json`,
      truncated,
      `\`\`\``,
      ``,
      `回复 **allow** 批准执行，或 **reject** 拒绝（120秒超时）`,
    ].join("\n");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EDIT_TOOLS = new Set([
  "write_file",
  "edit_file",
  "replace_in_file",
  "Write",
  "Edit",
]);

function isEditTool(name: string): boolean {
  return EDIT_TOOLS.has(name);
}

/** Singleton */
export const permissionGuard = new PermissionGuard();
