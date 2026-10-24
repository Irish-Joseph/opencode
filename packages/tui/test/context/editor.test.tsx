/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { EditorContextProvider, useEditorContext } from "../../src/context/editor"
import { TestTuiContexts } from "../fixture/tui-environment"

class FakeWebSocket {
  static current: FakeWebSocket | undefined
  readyState = 0
  sent: string[] = []
  private listeners: Record<string, Array<(event: { data?: string }) => void>> = {}

  constructor(public url: string) {
    FakeWebSocket.current = this
    setTimeout(() => {
      this.readyState = 1
      this.emit("open")
    }, 0)
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void) {
    ;(this.listeners[type] ??= []).push(listener)
  }

  removeEventListener() {}

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
    this.emit("close")
  }

  selection(params: unknown) {
    this.emit("message", { data: JSON.stringify({ jsonrpc: "2.0", method: "selection_changed", params }) })
  }

  private emit(type: string, event: { data?: string } = {}) {
    this.listeners[type]?.forEach((listener) => listener(event))
  }
}

// The provider reads the bridge port from the environment on init; keep the test's port private.
const withEditorPort = (port: string, run: () => Promise<void>) => {
  const saved: Record<string, string | undefined> = {
    OPENCODE_EDITOR_SSE_PORT: process.env.OPENCODE_EDITOR_SSE_PORT,
    CLAUDE_CODE_SSE_PORT: process.env.CLAUDE_CODE_SSE_PORT,
    ZED_TERM: process.env.ZED_TERM,
    TERM_PROGRAM: process.env.TERM_PROGRAM,
  }
  process.env.OPENCODE_EDITOR_SSE_PORT = port
  delete process.env.CLAUDE_CODE_SSE_PORT
  delete process.env.ZED_TERM
  delete process.env.TERM_PROGRAM
  return run().finally(() =>
    Object.entries(saved).forEach(([key, value]) =>
      value === undefined ? delete process.env[key] : (process.env[key] = value),
    ),
  )
}

test("normalizes 0-based WebSocket selection positions to the 1-based lines used by the Zed source", () =>
  withEditorPort("41234", async () => {
    let editor: ReturnType<typeof useEditorContext> | undefined
    function Reader() {
      editor = useEditorContext()
      return null
    }
    const app = await testRender(
      () => (
        <TestTuiContexts>
          <EditorContextProvider WebSocketImpl={FakeWebSocket as unknown as typeof WebSocket}>
            <Reader />
          </EditorContextProvider>
        </TestTuiContexts>
      ),
      { width: 100, height: 30 },
    )
    try {
      await new Promise((resolve) => setTimeout(resolve, 20))
      const socket = FakeWebSocket.current
      expect(socket?.url).toBe("ws://127.0.0.1:41234")
      expect(JSON.parse(socket!.sent[0]).method).toBe("initialize")

      socket!.selection({
        filePath: "/workspace/README.md",
        ranges: [
          { text: "thirteen", selection: { start: { line: 12, character: 0 }, end: { line: 15, character: 3 } } },
          { text: "first", selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } },
        ],
      })
      await Promise.resolve()

      const selection = editor?.selection()
      expect(selection?.source).toBe("websocket")
      expect(selection?.filePath).toBe("/workspace/README.md")
      expect(selection?.ranges.map((range) => range.selection)).toEqual([
        { start: { line: 13, character: 0 }, end: { line: 16, character: 3 } },
        { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
      ])
    } finally {
      app.renderer.destroy()
      FakeWebSocket.current = undefined
    }
  }),
)
