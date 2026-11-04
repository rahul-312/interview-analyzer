import { Html, Head, Main, NextScript } from "next/document";
import { ACCESS_KEY } from "@/services/ApiClient";

// Runs before the first paint, so logged-in users don't see the public pages
const markSession = `try{if(localStorage.getItem(${JSON.stringify(ACCESS_KEY)}))document.documentElement.dataset.session="1"}catch(e){}`;

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <script dangerouslySetInnerHTML={{ __html: markSession }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&display=swap"
        />
      </Head>
      <body className="antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
