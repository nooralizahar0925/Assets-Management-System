/**
 * The shape both custody dialogs take. Declared once so the detail page and the
 * dialogs cannot drift apart while Task 25 fills in the bodies.
 */
export interface CustodyDialogProps {
  assetId: string;
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful check-out or check-in, so the page can reload. */
  onDone: () => void;
}
