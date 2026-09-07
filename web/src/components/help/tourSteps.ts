/**
 * The first-run tour.
 *
 * Each step points at a `data-tour` attribute that must exist on screen, so the
 * tour only runs on the register - the one page where the sidebar, the filters,
 * a row and the scan button are all present at once. A step whose element is
 * missing is skipped silently by driver.js, which is the failure nobody
 * notices; the test beside this file checks the attributes exist in the source.
 */
export interface TourStep {
  element: string;
  popover: { title: string; description: string };
}

export const TOUR_STEPS: TourStep[] = [
  {
    element: '[data-tour="sidebar"]',
    popover: {
      title: "Everything lives here",
      description:
        "Your register, categories, locations, imports and reports. The dot marks a page with something new on it.",
    },
  },
  {
    element: '[data-tour="register"]',
    popover: {
      title: "The register",
      description:
        "Every asset you own. Search by name, tag or serial number — a partial serial read off a sticker is enough.",
    },
  },
  {
    element: '[data-tour="filters"]',
    popover: {
      title: "Narrow it down",
      description:
        "Filters combine. Category, status and location together get you to exactly the set you mean.",
    },
  },
  {
    element: '[data-tour="scan"]',
    popover: {
      title: "Scan a label",
      description:
        "Use the camera on your phone, or a USB scanner at a desk. Both jump straight to the asset.",
    },
  },
  {
    element: '[data-tour="help"]',
    popover: {
      title: "Help is on every page",
      description:
        "The ? explains the screen you are on and defines the words on it. You can replay this tour from there at any time.",
    },
  },
];
