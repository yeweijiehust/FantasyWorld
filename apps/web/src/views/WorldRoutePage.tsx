import { useParams } from "@tanstack/react-router";
import { WorldPage } from "./WorldPage.js";

export function WorldRoutePage() {
  const { saveId } = useParams({ from: "/world/$saveId" });
  return <WorldPage saveId={saveId} />;
}
