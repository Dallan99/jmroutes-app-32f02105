import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "JM Transportes — Last Mile" },
      { name: "description", content: "Plataforma operacional Last Mile da JM Transportes." },
    ],
  }),
  component: () => <Navigate to="/auth" replace />,
});
