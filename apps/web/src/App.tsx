import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from "react-router";
import { Layout } from "@/components/Layout";
import { Toaster } from "@/components/Toaster";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ColorSchemeProvider } from "@/hooks/useColorScheme";
import { ServerConfigProvider } from "@/hooks/useServerConfig";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UploadPage } from "@/pages/Upload";
import { DownloadPage } from "@/pages/Download";
import { NoteViewPage } from "@/pages/NoteView";
import { MyUploadsPage } from "@/pages/MyUploads";
import { HowItWorksPage } from "@/pages/HowItWorks";
import { RequestsPage } from "@/pages/Requests";
import { InboxPage } from "@/pages/Inbox";
import { RequestUploadPage } from "@/pages/RequestUpload";
import { TemplatesLinkPage } from "@/pages/TemplatesLink";
import { SettingsPage } from "@/pages/Settings";
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
      <ColorSchemeProvider>
        <TooltipProvider delayDuration={0}>
        <ServerConfigProvider>
          {/*
            Toaster stays ahead of the router, so a page that toasts while
            mounting is heard right away. Since Sonner 2.0.8 a Toaster that
            subscribes later also gets the toasts that are still active.
          */}
          <Toaster />
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<UploadPage />} />
                <Route path="/file/:id" element={<DownloadPage />} />
                <Route path="/note/:id" element={<NoteViewPage />} />
                <Route path="/d/:id" element={<LegacyDownloadRedirect />} />
                <Route path="/uploads" element={<MyUploadsPage />} />
                <Route path="/requests" element={<RequestsPage />} />
                <Route path="/inbox/:id" element={<InboxPage />} />
                <Route path="/request/:id" element={<RequestUploadPage />} />
                <Route path="/templates" element={<TemplatesLinkPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/how" element={<HowItWorksPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ServerConfigProvider>
        </TooltipProvider>
      </ColorSchemeProvider>
    </ErrorBoundary>
  );
}
