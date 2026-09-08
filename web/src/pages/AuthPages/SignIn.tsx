import PageMeta from "../../components/common/PageMeta";
import AuthLayout from "./AuthPageLayout";
import SignInForm from "../../components/auth/SignInForm";

export default function SignIn() {
  return (
    <>
      <PageMeta
        title="Sign in | Assets Management System"
        description="Sign in to your asset register."
      />
      <AuthLayout>
        <SignInForm />
      </AuthLayout>
    </>
  );
}
