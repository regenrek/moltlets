import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { AsyncButton } from "~/components/ui/async-button"

describe("AsyncButton", () => {
  it("renders normal content when not pending", () => {
    const html = renderToStaticMarkup(React.createElement(AsyncButton, null, "Save"))
    expect(html).toContain("Save")
    expect(html).not.toContain("aria-busy=\"true\"")
    expect(html).not.toContain("aria-label=\"Loading\"")
  })

  it("renders spinner + pending text and forces busy state", () => {
    const html = renderToStaticMarkup(
      React.createElement(AsyncButton, { pending: true, pendingText: "Saving..." }, "Save"),
    )
    expect(html).toContain("Saving...")
    expect(html).toContain("aria-busy=\"true\"")
    expect(html).toContain("aria-label=\"Loading\"")
    expect(html).toContain("disabled")
  })

  it("preserves disabled behavior when not pending", () => {
    const html = renderToStaticMarkup(React.createElement(AsyncButton, { disabled: true }, "Save"))
    expect(html).toContain("disabled")
    expect(html).toContain("Save")
  })
})
