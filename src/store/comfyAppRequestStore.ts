import { create } from "zustand";

interface ComfyAppRequestState {
  /** A pending request to open a ComfyUI app node's Replace dialog; that node consumes it. */
  request: { nodeId: string; at: number } | null;
  requestReplace: (nodeId: string) => void;
  consumeRequest: () => void;
}

/**
 * The node header's "Replace workflow…": the header lives on the canvas, the
 * dialog in the node, so the header asks here and the node answers.
 */
export const useComfyAppRequestStore = create<ComfyAppRequestState>((set) => ({
  request: null,
  requestReplace: (nodeId) => set({ request: { nodeId, at: Date.now() } }),
  consumeRequest: () => set({ request: null }),
}));

export const requestComfyReplace = (nodeId: string) => useComfyAppRequestStore.getState().requestReplace(nodeId);
