import { createContext, useContext, useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart, LineChart, PieChart } from 'echarts/charts';
import {
  CalendarComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import { ResolvedTheme, cssVar } from '../lib/theme';

echarts.use([
  BarChart,
  HeatmapChart,
  LineChart,
  PieChart,
  CalendarComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export const ThemeContext = createContext<ResolvedTheme>('dark');

export const SANS = "'Geist', -apple-system, sans-serif";

export interface ChartColors {
  text: string;
  text2: string;
  text3: string;
  line: string;
  lineStrong: string;
  panel: string;
  panel2: string;
  panel3: string;
  accent: string;
  break: string;
  heat0: string;
  // starší názvy
  muted: string;
  faint: string;
  border: string;
  surface: string;
  surface3: string;
}

/** Aktuální téma – použij jako závislost v useMemo pro options grafů. */
export function useTheme(): ResolvedTheme {
  return useContext(ThemeContext);
}

/** Barvy grafů z CSS proměnných aktuálního tématu. */
export function chartColors(): ChartColors {
  const c = {
    text: cssVar('--text'),
    text2: cssVar('--text-2'),
    text3: cssVar('--text-3'),
    line: cssVar('--line'),
    lineStrong: cssVar('--line-strong'),
    panel: cssVar('--panel'),
    panel2: cssVar('--panel-2'),
    panel3: cssVar('--panel-3'),
    accent: cssVar('--accent'),
    break: cssVar('--break'),
    heat0: cssVar('--heat-0'),
  };
  return { ...c, muted: c.text2, faint: c.text3, border: c.line, surface: c.panel, surface3: c.panel3 };
}

/** Společný styl tooltipu. */
export function tooltipBase(c: ChartColors) {
  return {
    backgroundColor: c.panel2,
    borderColor: c.lineStrong,
    borderWidth: 1,
    padding: [8, 11],
    textStyle: { color: c.text, fontFamily: SANS, fontSize: 12.5 },
    extraCssText: 'border-radius:8px;box-shadow:0 16px 40px rgba(0,0,0,.35);',
  };
}

/** Styl popisků os. */
export function axisLabel(c: ChartColors, extra: Record<string, unknown> = {}) {
  return { color: c.text3, fontSize: 11, fontFamily: SANS, ...extra };
}

export function Chart({ option, height = 260 }: { option: EChartsCoreOption; height?: number | string }) {
  const el = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!el.current) return;
    inst.current = echarts.init(el.current, undefined, { renderer: 'canvas' });
    const ro = new ResizeObserver(() => inst.current?.resize());
    ro.observe(el.current);
    // Po načtení webfontů graf překreslíme, aby popisky použily Geist.
    document.fonts?.ready.then(() => inst.current?.resize()).catch(() => {});
    return () => {
      ro.disconnect();
      inst.current?.dispose();
      inst.current = null;
    };
  }, []);

  useEffect(() => {
    inst.current?.setOption(
      {
        textStyle: { fontFamily: SANS },
        animationDuration: 450,
        animationEasing: 'cubicOut',
        ...option,
      },
      true,
    );
  }, [option]);

  return <div ref={el} style={{ width: '100%', height }} />;
}
