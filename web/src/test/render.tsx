import type { ReactElement, ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AppWrapper } from "../components/common/PageMeta";
import { AuthProvider } from "../context/AuthContext";

/**
 * Renders a page with the providers the real app supplies in main.tsx.
 *
 * PageMeta uses react-helmet-async, which throws without its provider - and the
 * failure surfaces deep inside HelmetDispatcher, pointing nowhere near the test.
 * Every page needs the router and the auth context too, so they live here rather
 * than being reassembled in each file.
 */
export function renderPage(
  ui: ReactElement,
  { route = "/" }: { route?: string } = {},
): RenderResult {
  return render(
    <AppWrapper>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </AppWrapper>,
  );
}

/** The same providers, for a test that supplies its own routing. */
export function withProviders(children: ReactNode): ReactElement {
  return (
    <AppWrapper>
      <AuthProvider>{children}</AuthProvider>
    </AppWrapper>
  );
}
