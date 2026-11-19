import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);

export type EChartsOption = echarts.EChartsCoreOption;

/**
 * An ECharts canvas that follows the size of its box. `onPick` receives the name of the clicked category or slice (cross filtering
 * in 3C-2 listens here). The chart is not readable by a screen reader, so the card also renders the same numbers as a table.
 */
export default function EChart({ option, onPick, label }: { option: EChartsOption; onPick?: (name: string) => void; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = box.current!;
    const c = echarts.init(el, undefined, { renderer: "canvas" });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    c.setOption(option, { notMerge: true });
    box.current?.setAttribute("data-chart-ready", "true");
  }, [option]);

  useEffect(() => {
    const c = chart.current;
    if (!c || !onPick) return;
    const h = (p: { name?: string }) => {
      if (p.name) onPick(p.name);
    };
    c.on("click", h);
    return () => void c.off("click", h);
  }, [onPick]);

  return <div ref={box} role="img" aria-label={label} className="h-full min-h-0 w-full" />;
}
