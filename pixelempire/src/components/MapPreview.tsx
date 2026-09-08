"use client";

import { useRouter } from "next/navigation";
import MapCanvas from "./MapCanvas";

/** Live, draggable map on the landing page. Selecting a plot hands off to the
 *  full claim experience rather than opening a second checkout surface. */
export default function MapPreview() {
  const router = useRouter();

  return (
    <MapCanvas
      selected={null}
      onSelect={(cell) => {
        if (cell) router.push(`/map?x=${cell.gridX}&y=${cell.gridY}`);
      }}
      className="h-[380px] w-full sm:h-[520px]"
    />
  );
}
