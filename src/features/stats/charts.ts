import type { EChartsCoreOption } from 'echarts/core';
import { ChartColors, MONO, axisLabel, tooltipBase } from '../../components/Chart';
import { addDays, dayKey, fmtDuration, startOfDay, WEEKDAYS_SHORT } from '../../lib/time';

/**
 * Továrny na options grafů. Každá bere data + barvy tématu a vrací option pro ECharts.
 * Nový graf = nová funkce tady + <Chart option={...}/> na stránce.
 */

const fmtMin = (min: number) => fmtDuration(min * 60);

/** Popisek osy v minutách: "45m", "1,5h" */
const fmtAxisMin = (v: number) =>
  v === 0 ? '0' : v < 60 ? `${v}m` : `${(v / 60).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })}h`;

/** Hezké dělení osy (15 min, 30 min, 1 h, 2 h…). */
function niceAxis(maxMin: number): { interval: number; max: number } {
  const steps = [15, 30, 60, 120, 180, 240, 300, 600, 1200, 2400, 6000];
  const interval = steps.find((st) => maxMin / st <= 4) ?? steps[steps.length - 1];
  return { interval, max: Math.max(interval, Math.ceil(maxMin / interval) * interval) };
}

const ramp = (c: ChartColors) => [c.heat0, `${c.accent}40`, `${c.accent}80`, `${c.accent}c0`, c.accent];

function catAxis(c: ChartColors, data: string[], extra: Record<string, unknown> = {}) {
  return {
    type: 'category',
    data,
    axisLine: { lineStyle: { color: c.lineStrong } },
    axisTick: { show: false },
    axisLabel: axisLabel(c),
    ...extra,
  };
}

function minAxis(c: ChartColors, max: number) {
  return {
    type: 'value',
    ...niceAxis(max),
    splitLine: { lineStyle: { color: c.line } },
    axisLabel: axisLabel(c, { formatter: fmtAxisMin }),
  };
}

const legend = (c: ChartColors) => ({
  top: 0,
  right: 0,
  textStyle: { color: c.text2, fontSize: 11.5 },
  itemWidth: 10,
  itemHeight: 10,
  itemGap: 14,
  icon: 'rect',
});

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
        `<b>${new Date(p.value[0]).toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'long' })}</b><br/>${p.value[1] ? fmtMin(p.value[1]) : 'Bez učení'}`,
    },
    visualMap: { show: false, min: 0, max, inRange: { color: ramp(c) } },
    calendar: {
      top: compact ? 20 : 24,
      left: 30,
      right: 4,
      bottom: 2,
      range: [dayKey(start), dayKey(end)],
      cellSize: ['auto', compact ? 14 : 16],
      orient: 'horizontal',
      splitLine: { show: false },
      itemStyle: { color: 'transparent', borderColor: c.panel, borderWidth: 3 },
      yearLabel: { show: false },
      dayLabel: { firstDay: 1, nameMap: ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'], color: c.text3, fontSize: 10, fontFamily: MONO },
      monthLabel: {
        nameMap: ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'],
        color: c.text3,
        fontSize: 10.5,
        fontFamily: MONO,
      },
    },
    series: [
      {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: points,
        itemStyle: { borderRadius: 2, borderColor: c.panel, borderWidth: 2.5 },
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
  const max = Math.max(0, ...labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0)));
  return {
    grid: { left: 4, right: 4, top: 30, bottom: 2 },
    legend: legend(c),
    tooltip: {
      ...tooltipBase(c),
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: `${c.text}08` } },
      valueFormatter: (v: number) => fmtMin(v),
    },
    xAxis: catAxis(c, labels),
    yAxis: minAxis(c, max),
    series: series.map((s, i) => ({
      name: s.name,
      type: 'bar',
      stack: 'total',
      data: s.values.map((v) => Math.round(v)),
      itemStyle: { color: s.color, borderRadius: i === series.length - 1 ? [2, 2, 0, 0] : 0, borderColor: c.panel, borderWidth: 0.5 },
      barMaxWidth: 30,
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
    grid: { left: 4, right: 4, top: 30, bottom: 2 },
    tooltip: { ...tooltipBase(c), trigger: 'axis', axisPointer: { lineStyle: { color: c.lineStrong } }, valueFormatter: (v: number) => fmtMin(v) },
    legend: legend(c),
    xAxis: catAxis(c, labels, { boundaryGap: true }),
    yAxis: minAxis(c, Math.max(goalMin, ...values)),
    series: [
      {
        name: 'Den',
        type: 'bar',
        data: values.map((v) => Math.round(v)),
        itemStyle: { color: c.lineStrong, borderRadius: [2, 2, 0, 0] },
        emphasis: { itemStyle: { color: c.text3 } },
        barMaxWidth: 14,
        markLine: goalMin
          ? {
              silent: true,
              symbol: 'none',
              lineStyle: { color: c.text3, type: [4, 4], width: 1 },
              label: { color: c.text3, formatter: 'cíl', position: 'insideEndTop', fontSize: 10.5, fontFamily: MONO },
              data: [{ yAxis: goalMin }],
            }
          : undefined,
      },
      {
        name: '7denní průměr',
        type: 'line',
        data: avg,
        smooth: 0.3,
        symbol: 'none',
        lineStyle: { color: c.accent, width: 2 },
        itemStyle: { color: c.accent },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `${c.accent}22` },
              { offset: 1, color: `${c.accent}00` },
            ],
          },
        },
      },
    ],
  };
}

/** Donut podle předmětů, uprostřed celkový čas. */
export function donut(c: ChartColors, items: { name: string; color: string; min: number }[]): EChartsCoreOption {
  const total = items.reduce((a, i) => a + i.min, 0);
  return {
    title: {
      text: fmtDuration(total * 60, { short: true }),
      subtext: 'CELKEM',
      left: 'center',
      top: '38%',
      textStyle: { color: c.text, fontFamily: MONO, fontSize: 20, fontWeight: 450 },
      subtextStyle: { color: c.text3, fontFamily: MONO, fontSize: 10 },
      itemGap: 4,
    },
    tooltip: {
      ...tooltipBase(c),
      trigger: 'item',
      formatter: (p: { name: string; value: number; percent: number }) => `<b>${p.name}</b><br/>${fmtMin(p.value)} · ${p.percent} %`,
    },
    series: [
      {
        type: 'pie',
        radius: ['72%', '88%'],
        padAngle: 1.5,
        itemStyle: { borderRadius: 2 },
        label: { show: false },
        emphasis: { scale: true, scaleSize: 3 },
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
    grid: { left: 4, right: 4, top: 4, bottom: 2 },
    tooltip: {
      ...tooltipBase(c),
      formatter: (p: { value: [number, number, number] }) =>
        `<b>${WEEKDAYS_SHORT[6 - p.value[1]]} ${p.value[0]}:00–${p.value[0] + 1}:00</b><br/>${fmtMin(p.value[2])} celkem`,
    },
    xAxis: catAxis(c, Array.from({ length: 24 }, (_, i) => `${i}`), {
      axisLine: { show: false },
      axisLabel: axisLabel(c, { interval: 2 }),
    }),
    yAxis: catAxis(c, [...WEEKDAYS_SHORT].reverse(), { axisLine: { show: false } }),
    visualMap: { show: false, min: 0, max, inRange: { color: ramp(c) } },
    series: [
      {
        type: 'heatmap',
        data,
        itemStyle: { borderRadius: 2, borderColor: c.panel, borderWidth: 2 },
        emphasis: { itemStyle: { borderColor: c.text, borderWidth: 1 } },
      },
    ],
  };
}

/** Minuty a průměrné soustředění podle hodiny dne. */
export function hourBars(c: ChartColors, minutes: number[], focus: (number | null)[]): EChartsCoreOption {
  const hasFocus = focus.some((f) => f != null);
  return {
    grid: { left: 4, right: 4, top: 30, bottom: 2 },
    tooltip: {
      ...tooltipBase(c),
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: `${c.text}08` } },
      formatter: (ps: { seriesName: string; value: number | null; axisValue: string }[]) => {
        const h = ps[0]?.axisValue;
        return [`<b>${h}:00–${Number(h) + 1}:00</b>`]
          .concat(
            ps.map((p) =>
              p.seriesName === 'Soustředění'
                ? `Soustředění: ${p.value != null ? Number(p.value).toFixed(1) + ' / 5' : '—'}`
                : `Čas: ${fmtMin(p.value ?? 0)}`,
            ),
          )
          .join('<br/>');
      },
    },
    legend: hasFocus ? legend(c) : undefined,
    xAxis: catAxis(c, Array.from({ length: 24 }, (_, i) => `${i}`), { axisLabel: axisLabel(c, { interval: 2 }) }),
    yAxis: [minAxis(c, Math.max(0, ...minutes)), { type: 'value', min: 0, max: 5, show: false }],
    series: [
      {
        name: 'Čas',
        type: 'bar',
        data: minutes.map((v) => Math.round(v)),
        itemStyle: { color: c.lineStrong, borderRadius: [2, 2, 0, 0] },
        emphasis: { itemStyle: { color: c.text3 } },
        barMaxWidth: 16,
      },
      ...(hasFocus
        ? [
            {
              name: 'Soustředění',
              type: 'line',
              yAxisIndex: 1,
              data: focus,
              connectNulls: true,
              smooth: 0.25,
              symbol: 'circle',
              symbolSize: 5,
              lineStyle: { color: c.accent, width: 1.5 },
              itemStyle: { color: c.accent },
            },
          ]
        : []),
    ],
  };
}

/** Sloupce s jedním zvýrazněným maximem (např. dny v týdnu). */
export function highlightBars(c: ChartColors, labels: string[], values: number[], unit: 'min' | 'raw' = 'min'): EChartsCoreOption {
  const max = Math.max(0, ...values);
  return {
    grid: { left: 4, right: 4, top: 10, bottom: 2 },
    tooltip: {
      ...tooltipBase(c),
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: `${c.text}08` } },
      valueFormatter: (v: number) => (unit === 'min' ? fmtMin(v) : String(v)),
    },
    xAxis: catAxis(c, labels),
    yAxis: unit === 'min' ? minAxis(c, max) : { type: 'value', splitLine: { lineStyle: { color: c.line } }, axisLabel: axisLabel(c) },
    series: [
      {
        type: 'bar',
        data: values.map((v) => ({
          value: Math.round(v),
          itemStyle: { color: v === max && max > 0 ? c.accent : c.lineStrong, borderRadius: [2, 2, 0, 0] },
        })),
        barMaxWidth: 26,
      },
    ],
  };
}

/** Porovnání předmětů: minulé vs. aktuální období. */
export function compareBars(c: ChartColors, items: { name: string; color: string; cur: number; prev: number }[], prevLabel: string, curLabel: string): EChartsCoreOption {
  const sorted = [...items].sort((a, b) => a.cur - b.cur);
  return {
    grid: { left: 4, right: 12, top: 30, bottom: 2 },
    legend: { ...legend(c), data: [prevLabel, curLabel] },
    tooltip: { ...tooltipBase(c), trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: `${c.text}08` } }, valueFormatter: (v: number) => fmtMin(v) },
    xAxis: { type: 'value', splitLine: { lineStyle: { color: c.line } }, axisLabel: axisLabel(c, { formatter: fmtAxisMin }) },
    yAxis: { type: 'category', data: sorted.map((i) => i.name), axisLine: { lineStyle: { color: c.lineStrong } }, axisTick: { show: false }, axisLabel: { color: c.text2, fontSize: 12 } },
    series: [
      {
        name: prevLabel,
        type: 'bar',
        data: sorted.map((i) => Math.round(i.prev)),
        itemStyle: { color: c.lineStrong, borderRadius: [0, 2, 2, 0] },
        barMaxWidth: 10,
        barGap: '30%',
      },
      {
        name: curLabel,
        type: 'bar',
        data: sorted.map((i) => ({ value: Math.round(i.cur), itemStyle: { color: i.color, borderRadius: [0, 2, 2, 0] } })),
        itemStyle: { color: c.accent },
        barMaxWidth: 10,
      },
    ],
  };
}
