/** Unit conversions. 1 knot = 1 nautical mile per hour = 1.852 km/h = 1852 m per 3600 s. */
export const kmhToKn = (v: number): number => v / 1.852;
export const msToKn = (v: number): number => (v * 3600) / 1852;
