import { useEffect } from "react";
import "./LandingPage.css";

const referenceLandingUrl = `${import.meta.env.BASE_URL}typefree-landing/index.html`;

export default function LandingPage() {
  useEffect(() => {
    document.documentElement.classList.add("landing-frame-html");
    document.body.classList.add("landing-frame-body");
    const previousTitle = document.title;
    document.title = "typefree";

    return () => {
      document.documentElement.classList.remove("landing-frame-html");
      document.body.classList.remove("landing-frame-body");
      document.title = previousTitle;
    };
  }, []);

  return (
    <main className="landing-frame-shell">
      <iframe className="landing-reference-frame" src={referenceLandingUrl} title="typefree landing page" />
    </main>
  );
}
