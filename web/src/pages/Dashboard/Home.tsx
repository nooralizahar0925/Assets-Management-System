import PageMeta from "../../components/common/PageMeta";
import ComingSoon from "../ComingSoon";

// Task 27 replaces this with the real dashboard, against
// GET /api/v1/dashboard/summary.
export default function Home() {
  return (
    <>
      <PageMeta
        title="Dashboard | Assets Management System"
        description="What you own, what is out, and what needs attention."
      />
      <ComingSoon title="Dashboard" />
    </>
  );
}
