import { HomePage, homeMetadata } from "@/components/pages/home-page";

export const metadata = homeMetadata("de");

export default function Home() {
  return <HomePage locale="de" />;
}
