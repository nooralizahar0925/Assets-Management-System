import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import OnboardingChecklist, {
  checklistFor, type OnboardingState,
} from "./OnboardingChecklist";

const NOTHING_DONE: OnboardingState = {
  categories: 0, assets: 0, users: 1, api_keys: 0, imports: 0, checkouts: 0,
};

const allows = (...permissions: string[]) => (p: string) => permissions.includes(p);
const admin = allows(
  "categories:write", "assets:import", "custody:write", "users:write",
  "api_keys:write",
);
const technician = allows("custody:write");

const render_ = (can: (p: string) => boolean, state: OnboardingState) =>
  render(
    <MemoryRouter>
      <OnboardingChecklist can={can} state={state} />
    </MemoryRouter>,
  );

describe("choosing the steps", () => {
  it("gives an administrator the setup work a technician never sees", () => {
    const forAdmin = checklistFor(admin, NOTHING_DONE).map((i) => i.id);
    const forTech = checklistFor(technician, NOTHING_DONE).map((i) => i.id);

    expect(forAdmin).toContain("invite-team");
    expect(forTech).not.toContain("invite-team");
    expect(forTech).toEqual(["check-out"]);
  });

  it("never offers a step the API would refuse", () => {
    // Sending somebody to Import when they cannot import is worse than saying
    // nothing: they follow the instruction and are told no.
    for (const item of checklistFor(technician, NOTHING_DONE)) {
      expect(technician(item.needs)).toBe(true);
    }
  });

  it("marks an item done from the register, not from a stored flag", () => {
    const before = checklistFor(admin, NOTHING_DONE)
      .find((i) => i.id === "create-category");
    const after = checklistFor(admin, { ...NOTHING_DONE, categories: 2 })
      .find((i) => i.id === "create-category");

    expect(before?.done).toBe(false);
    expect(after?.done).toBe(true);
  });

  it("does not treat the founder alone as an invited team", () => {
    // Every organisation has one user from the moment it exists. Counting that
    // as "invited your colleagues" would tick the item before anybody tried.
    const one = checklistFor(admin, { ...NOTHING_DONE, users: 1 })
      .find((i) => i.id === "invite-team");
    const two = checklistFor(admin, { ...NOTHING_DONE, users: 2 })
      .find((i) => i.id === "invite-team");

    expect(one?.done).toBe(false);
    expect(two?.done).toBe(true);
  });

  it("counts assets added by hand as bringing in the register", () => {
    // Somebody who typed in forty assets has done the step, whatever route
    // they took to it.
    const item = checklistFor(admin, { ...NOTHING_DONE, assets: 40 })
      .find((i) => i.id === "add-assets");
    expect(item?.done).toBe(true);
  });
});

describe("the checklist on the dashboard", () => {
  it("shows what is left with a progress count", () => {
    render_(admin, { ...NOTHING_DONE, categories: 1 });
    expect(screen.getByText("1 of 5")).toBeInTheDocument();
  });

  it("links each remaining step to the page that does it", () => {
    render_(admin, NOTHING_DONE);
    expect(screen.getByRole("link", { name: /first category/i }))
      .toHaveAttribute("href", "/categories");
  });

  it("stops linking a step that is already done", () => {
    render_(admin, { ...NOTHING_DONE, categories: 1 });
    expect(screen.queryByRole("link", { name: /first category/i })).not.toBeInTheDocument();
    expect(screen.getByText(/first category/i)).toBeInTheDocument();
  });

  it("disappears once everything is done", () => {
    const { container } = render_(admin, {
      categories: 3, assets: 40, users: 4, api_keys: 1, imports: 1, checkouts: 2,
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing to somebody with no setup permissions at all", () => {
    const { container } = render_(allows("assets:read"), NOTHING_DONE);
    expect(container).toBeEmptyDOMElement();
  });
});
