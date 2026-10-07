import { createContext, useContext, useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart, LineChart, PieChart } from 'echarts/charts';
import {
  CalendarComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  MarkLineComponent,
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
  TooltipComponent,
  VisualMapComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

export const ThemeContext = createContext<ResolvedTheme>('dark');

export interface ChartColors {
  text: string;
  muted: string;
  faint: string;
  border: string;
  surface: string;
  surface3: string;
  accent: string;
  break: string;
  heat0: string;
}

/** Aktuální téma – použij jako závislost v useMemo pro options grafů. */
export function useTheme(): ResolvedTheme {
  return useContext(ThemeContext);
}

/** Barvy grafů z CSS proměnných aktuálního tématu. */
export function chartColors(): ChartColors {
  return {
    text: cssVar('--text'),
    muted: cssVar('--text-muted'),
    faint: cssVar('--text-faint'),
    border: cssVar('--border'),
    surface: cssVar('--surface'),
    surface3: cssVar('--surface-3'),
    accent: cssVar('--accent'),
    break: cssVar('--break'),
    heat0: cssVar('--heat-0'),
  };
}

/** Společný styl tooltipu. */
export function tooltipBase(c: ChartColors) {
  return {
    backgroundColor: c.surface3,
    borderColor: c.border,
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { color: c.text, fontFamily: 'Inter, -apple-system, sans-serif', fontSize: 12.5 },
    extraCssText: 'border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.35);',
  };
}

export function Chart({ option, height = 260 }: { option: EChartsCoreOption; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!el.current) return;
    inst.current = echarts.init(el.current, undefined, { renderer: 'canvas' });
    const ro = new ResizeObserver(() => inst.current?.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      inst.current?.dispose();
      inst.current = null;
    };
  }, []);

  useEffect(() => {
    inst.current?.setOption(
      {
        textStyle: { fontFamily: 'Inter, -apple-system, sans-serif' },
        animationDuration: 500,
        ...option,
      },
      true,
    );
  }, [option]);

  return <div ref={el} style={{ width: '100%', height }} />;
}
