/** A read-only path through the register, separate from the on-screen driver tour. */
export interface WalkthroughStep {
  id: string;
  title: string;
  description: string;
  href?: string;
  label?: string;
  permission?: string;
}

export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  { id: "welcome", title: "Get oriented", description: "Use the sidebar to move between modules. The dashboard shows the state of the register and work needing attention. This walkthrough only opens pages; it does not change records.", href: "/", label: "Open dashboard" },
  { id: "register", title: "Explore the asset register", description: "Search by name, asset tag, or serial number. Combine category, status, and location filters to find the assets you need.", href: "/assets", label: "Open assets", permission: "assets:read" },
  { id: "catalogue", title: "Understand categories and locations", description: "Categories define extra fields and depreciation policies. Locations form a tree from sites down to rooms.", href: "/categories", label: "Open categories", permission: "categories:read" },
  { id: "import", title: "Bring in existing records", description: "Upload a CSV or Excel file, map its columns, and review the dry-run preview before committing an import.", href: "/import", label: "Open import", permission: "assets:import" },
  { id: "custody", title: "Follow asset custody", description: "Open an asset to see its history and current holder. Check-out and check-in actions record who had it and when it came back.", href: "/assets", label: "Open assets", permission: "assets:read" },
  { id: "stocktake", title: "Count what is on site", description: "A stock-take compares scanned assets against the register. Investigate missing and unexpected items before closing a session.", href: "/stocktakes", label: "Open stock-takes", permission: "stocktake:read" },
  { id: "reports", title: "Use reports", description: "Choose a report, set filters, and download the format your team needs. Saved reports can be scheduled when your role allows it.", href: "/reports", label: "Open reports", permission: "reports:read" },
  { id: "finish", title: "Return whenever you need help", description: "Search the guide for any task, open the ? on a screen for focused help, or replay the on-screen tour. Your progress stays in this browser." },
];
