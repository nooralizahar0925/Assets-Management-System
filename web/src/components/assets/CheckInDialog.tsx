import { Modal } from "../ui/modal";
import type { CustodyDialogProps } from "./custodyDialogProps";

// Task 25 implements this. The props are already final, so the detail page does
// not change when the body arrives.
export default function CheckInDialog({ isOpen, onClose }: CustodyDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-lg p-6">
      <h4 className="mb-2 text-lg font-semibold text-gray-800 dark:text-white/90">
        Check in
      </h4>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        This dialog is not built yet.
      </p>
    </Modal>
  );
}
