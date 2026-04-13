import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Toaster } from "@/components/Toaster";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/hooks/useTheme";
import { ServerConfigProvider } from "@/hooks/useServerConfig";
import { UploadPage } from "@/pages/Upload";
import { DownloadPage } from "@/pages/Download";
import { MyUploadsPage } from "@/pages/MyUploads";
import { NotFoundPage } from "@/pages/NotFound";

/**
 * Redirect /d/:id to /file/:id while preserving the hash fragment.
 * React Router's <Navigate> does not forward the hash, so we do it manually.
 */
function LegacyDownloadRedirect() {
  const { id } = useParams();
  const { hash } = useLocation();
  return <Navigate to={`/file/${id}${hash}`} replace />;
}

export function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ServerConfigProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<UploadPage />} />
                <Route path="/file/:id" element={<DownloadPage />} />
                <Route path="/d/:id" element={<LegacyDownloadRedirect />} />
                <Route path="/uploads" element={<MyUploadsPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
          <Toaster />
        </ServerConfigProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
