import { BarChart, BoxplotChart, CustomChart, FunnelChart, GaugeChart, HeatmapChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { token } from "@/lib/theme";
import type { PickInfo } from "@/lib/dashboard/types";

echarts.use([BarChart, BoxplotChart, CustomChart, FunnelChart, GaugeChart, HeatmapChart, LineChart, PieChart, ScatterChart, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

export type EChartsOption = echarts.EChartsCoreOption;

/** What a card can ask of a drawn chart: its picture as PNG. */
export interface ChartExport {
  png(): string;
}

/**
 * An ECharts canvas that follows the size of its box. `onPick` receives the group columns and values of the clicked element (the data
 * items of the options carry them in `pick`): cross filtering listens here. The chart is not readable by a screen reader, so the card also
 * renders the same numbers as a table. `exportRef` is filled with a function that returns the picture as a PNG (data URL).
 */
export default function EChart({ option, onPick, label, exportRef }: { option: EChartsOption; onPick?: (pick: PickInfo) => void; label: string; exportRef?: { current: ChartExport | null } }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = box.current!;
    const c = echarts.init(el, undefined, { renderer: "canvas" });
    chart.current = c;
    // Browser tests find the drawn marks through this handle (only in the dev build).
    if (import.meta.env.DEV) (el as HTMLDivElement & { __echart?: unknown }).__echart = c;
    if (exportRef) exportRef.current = { png: () => c.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: token("--card") }) };
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
      if (exportRef) exportRef.current = null;
    };
  }, [exportRef]);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    c.setOption(option, { notMerge: true });
    box.current?.setAttribute("data-chart-ready", "true");
  }, [option]);

  useEffect(() => {
    const c = chart.current;
    if (!c || !onPick) return;
    const h = (p: { data?: unknown }) => {
      const pick = (p.data as { pick?: PickInfo } | null | undefined)?.pick;
      if (pick) onPick(pick);
    };
    c.on("click", h);
    return () => void c.off("click", h);
  }, [onPick]);

  return <div ref={box} role="img" aria-label={label} className="h-full min-h-0 w-full" />;
}
