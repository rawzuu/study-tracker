import type { EChartsCoreOption } from 'echarts/core';
import { ChartColors, tooltipBase } from '../../components/Chart';
import { addDays, dayKey, fmtDuration, startOfDay, WEEKDAYS_SHORT } from '../../lib/time';

/**
 * Továrny na options grafů. Každá bere data + barvy tématu a vrací option pro ECharts.
 * Nový graf = nová funkce tady + <Chart option={...}/> na stránce.
 */

const fmtMinTooltip = (min: number) => fmtDuration(min * 60);

/** Popisek osy v minutách: "45 m", "1,5 h" */
const fmtAxisMin = (v: number) => (v === 0 ? '0' : v < 60 ? `${v} m` : `${(v / 60).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} h`);

/** Hezké dělení osy (15 min, 30 min, 1 h, 2 h…) místo zvláštních hodnot jako 1,7 h. */
function niceAxis(maxMin: number): { interval: number; max: number } {
  const steps = [15, 30, 60, 120, 180, 240, 300, 600, 1200, 2400, 6000];
  const interval = steps.find((st) => maxMin / st <= 5) ?? steps[steps.length - 1];
  return { interval, max: Math.max(interval, Math.ceil(maxMin / interval) * interval) };
}

/** Heatmapa ve stylu GitHubu. */
export function calendarHeatmap(c: ChartColors, perDay: Map<string, number>, days: number, compact = false): EChartsCoreOption {
  const end = startOfDay(Date.now());
  const start = addDays(end, -days + 1);
  const points: [string, number][] = [];
  for (let t = start; t <= end; t = addDays(t, 1)) {
    const k = dayKey(t);
    points.push([k, Math.round((perDay.get(k) ?? 0) / 60)]);
  }
  const max = Math.max(60, ...points.map((p) => p[1]));
  return {
    tooltip: {
      ...tooltipBase(c),
      formatter: (p: { value: [string, number] }) =>
        `<b>${new Date(p.value[0]).toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'long' })}</b><br/>${p.value[1] ? fmtMinTooltip(p.value[1]) : 'Bez učení'}`,
    },
    visualMap: {
      show: false,
      min: 0,
      max,
      inRange: { color: [c.heat0, `${c.accent}55`, `${c.accent}aa`, c.accent] },
    },
    calendar: {
      top: compact ? 22 : 28,
      left: 34,
      right: 8,
      bottom: 4,
      range: [dayKey(start), dayKey(end)],
      cellSize: ['auto', compact ? 13 : 15],
      orient: 'horizontal',
      splitLine: { show: false },
      itemStyle: { color: 'transparent', borderColor: c.surface, borderWidth: 3, borderRadius: 3 },
      yearLabel: { show: false },
      dayLabel: { firstDay: 1, nameMap: ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'], color: c.faint, fontSize: 10.5 },
      monthLabel: {
        nameMap: ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'],
        color: c.faint,
        fontSize: 11,
      },
    },
    series: [
      {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: points,
        itemStyle: { borderRadius: 3, borderColor: c.surface, borderWidth: 2 },
      },
    ],
  };
}

export interface SeriesDef {
  name: string;
  color: string;
  values: number[]; // minuty
}

/** Skládaný sloupcový graf (např. týdny × předměty). */
export function stackedBars(c: ChartColors, labels: string[], series: SeriesDef[]): EChartsCoreOption {
  return {
    grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipBase(c),
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: `${c.accent}12` } },
      valueFormatter: (v: number) => fmtMinTooltip(v),
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLine: { lineStyle: { color: c.border } },
      axisTick: { show: false },
      axisLabel: { color: c.faint, fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      ...niceAxis(Math.max(0, ...labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0)))),
      splitLine: { lineStyle: { color: c.border } },
      axisLabel: { color: c.faint, fontSize: 11, formatter: fmtAxisMin },
    },
    series: series.map((s, i) => ({
      name: s.name,
      type: 'bar',
      stack: 'total',
      data: s.values.map((v) => Math.round(v)),
      itemStyle: {
        color: s.color,
        borderRadius: i === series.length - 1 ? [5, 5, 0, 0] : 0,
      },
      barMaxWidth: 34,
      emphasis: { focus: 'series' },
    })),
  };
}

/** Denní minuty + klouzavý 7denní průměr. */
export function trendLine(c: ChartColors, labels: string[], values: number[], goalMin: number): EChartsCoreOption {
  const avg = values.map((_, i) => {
    const w = values.slice(Math.max(0, i - 6), i + 1);
    return Math.round(w.reduce((a, b) => a + b, 0) / w.length);
  });
  return {
    grid: { left: 8, right: 8, top: 20, bottom: 4, containLabel: true },
    tooltip: { ...tooltipBase(c), trigger: 'axis', valueFormatter: (v: number) => fmtMinTooltip(v) },
    legend: {
      top: 0,
      right: 0,
      textStyle: { color: c.muted, fontSize: 11.5 },
      itemWidth: 14,
      itemHeight: 8,
      icon: 'roundRect',
    },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: true,
      axisLine: { lineStyle: { color: c.border } },
      axisTick: { show: false },
      axisLabel: { color: c.faint, fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      ...niceAxis(Math.max(goalMin, ...values)),
      splitLine: { lineStyle: { color: c.border } },
      axisLabel: { color: c.faint, fontSize: 11, formatter: fmtAxisMin },
    },
    series: [
      {
        name: 'Den',
        type: 'bar',
        data: values.map((v) => Math.round(v)),
        itemStyle: { color: `${c.accent}55`, borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 16,
        markLine: goalMin
          ? {
              silent: true,
              symbol: 'none',
              lineStyle: { color: c.break, type: 'dashed', width: 1.5 },
              label: { color: c.break, formatter: 'cíl', position: 'insideEndTop', fontSize: 11 },
              data: [{ yAxis: goalMin }],
            }
          : undefined,
      },
      {
        name: '7denní průměr',
        type: 'line',
        data: avg,
        smooth: 0.35,
        symbol: 'none',
        lineStyle: { color: c.accent, width: 2.5 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `${c.accent}33` },
              { offset: 1, color: `${c.accent}00` },
            ],
          },
        },
      },
    ],
  };
}

/** Donut podle předmětů. */
export function donut(c: ChartColors, items: { name: string; color: string; min: number }[]): EChartsCoreOption {
  return {
    tooltip: {
      ...tooltipBase(c),
      trigger: 'item',
      formatter: (p: { name: string; value: number; percent: number }) => `<b>${p.name}</b><br/>${fmtMinTooltip(p.value)} · ${p.percent} %`,
    },
    series: [
      {
        type: 'pie',
        radius: ['58%', '86%'],
        padAngle: 2,
        itemStyle: { borderRadius: 6 },
        label: { show: false },
        emphasis: { scale: true, scaleSize: 5 },
        data: items.map((i) => ({ name: i.name, value: Math.round(i.min), itemStyle: { color: i.color } })),
      },
    ],
  };
}

/** Den v týdnu × hodina. */
export function weekHourHeatmap(c: ChartColors, matrix: number[][]): EChartsCoreOption {
  const data: [number, number, number][] = [];
  let max = 1;
  matrix.forEach((row, d) =>
    row.forEach((v, h) => {
      data.push([h, 6 - d, Math.round(v)]);
      max = Math.max(max, v);
    }),
  );
  return {
    grid: { left: 8, right: 8, top: 8, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipBase(c),
      formatter: (p: { value: [number, number, number] }) =>
        `<b>${WEEKDAYS_SHORT[6 - p.value[1]]} ${p.value[0]}:00–${p.value[0] + 1}:00</b><br/>${fmtMinTooltip(p.value[2])} celkem`,
    },
    xAxis: {
      type: 'category',
      data: Array.from({ length: 24 }, (_, i) => `${i}`),
      splitArea: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: c.faint, fontSize: 10.5, interval: 2 },
    },
    yAxis: {
      type: 'category',
      data: [...WEEKDAYS_SHORT].reverse(),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: c.faint, fontSize: 11 },
    },
    visualMap: { show: false, min: 0, max, inRange: { color: [c.heat0, `${c.accent}66`, c.accent] } },
    series: [
      {
        type: 'heatmap',
        data,
        itemStyle: { borderRadius: 4, borderColor: c.surface, borderWidth: 2 },
        emphasis: { itemStyle: { borderColor: c.text, borderWidth: 1 } },
      },
    ],
  };
}

/** Minuty a průměrné soustředění podle hodiny dne. */
export function hourBars(c: ChartColors, minutes: number[], focus: (number | null)[]): EChartsCoreOption {
  const hasFocus = focus.some((f) => f != null);
  return {
    grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipBase(c),
      trigger: 'axis',
      formatter: (ps: { seriesName: string; value: number | null; axisValue: string }[]) => {
        const h = ps[0]?.axisValue;
        return [`<b>${h}:00–${Number(h) + 1}:00</b>`]
          .concat(
            ps.map((p) =>
              p.seriesName === 'Soustředění'
                ? `Soustředění: ${p.value != null ? Number(p.value).toFixed(1) + ' / 5' : '—'}`
                : `Čas: ${fmtMinTooltip(p.value ?? 0)}`,
            ),
          )
          .join('<br/>');
      },
    },
    legend: hasFocus
      ? { top: 0, right: 0, textStyle: { color: c.muted, fontSize: 11.5 }, itemWidth: 14, itemHeight: 8, icon: 'roundRect' }
      : undefined,
    xAxis: {
      type: 'category',
      data: Array.from({ length: 24 }, (_, i) => `${i}`),
      axisLine: { lineStyle: { color: c.border } },
      axisTick: { show: false },
      axisLabel: { color: c.faint, fontSize: 10.5, interval: 2 },
    },
    yAxis: [
      {
        type: 'value',
        ...niceAxis(Math.max(0, ...minutes)),
        splitLine: { lineStyle: { color: c.border } },
        axisLabel: { color: c.faint, fontSize: 11, formatter: fmtAxisMin },
      },
      { type: 'value', min: 1, max: 5, show: false },
    ],
    series: [
      {
        name: 'Čas',
        type: 'bar',
        data: minutes.map((v) => Math.round(v)),
        itemStyle: { color: `${c.accent}99`, borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 18,
      },
      ...(hasFocus
        ? [
            {
              name: 'Soustředění',
              type: 'line',
              yAxisIndex: 1,
              data: focus,
              connectNulls: true,
              smooth: 0.3,
              symbol: 'circle',
              symbolSize: 6,
              lineStyle: { color: c.break, width: 2 },
              itemStyle: { color: c.break },
            },
          ]
        : []),
    ],
  };
}
