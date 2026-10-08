import { HomePage, homeMetadata } from "@/components/pages/home-page";

export const metadata = homeMetadata("en");

export default function Home() {
  return <HomePage locale="en" />;
}
