import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Toaster } from "@/components/Toaster";
import { ThemeProvider } from "@/hooks/useTheme";
import { ServerConfigProvider } from "@/hooks/useServerConfig";
import { UploadPage } from "@/pages/Upload";
import { DownloadPage } from "@/pages/Download";
import { MyUploadsPage } from "@/pages/MyUploads";
import { NotFoundPage } from "@/pages/NotFound";

export function App() {
  return (
    <ThemeProvider>
      <ServerConfigProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<UploadPage />} />
              <Route path="/d/:id" element={<DownloadPage />} />
              <Route path="/uploads" element={<MyUploadsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster />
      </ServerConfigProvider>
    </ThemeProvider>
  );
}
