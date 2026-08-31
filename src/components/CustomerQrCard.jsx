import { useMemo } from 'react';
import { Platform } from 'react-native';
import Svg, { Circle, G, Image as SvgImage, Path, Rect, Text as SvgText } from 'react-native-svg';
import { qrMatrixFromValue, qrPathFromMatrix, wrapQrLabel } from '../utils/qrMatrix';

export const QR_CARD_BASE_WIDTH = 720;
export const QR_CARD_BASE_HEIGHT = 1060;
const QR_SIZE = 480;

/**
 * Branded print card: GasTech logo + name above QR, customer name only below.
 */
export default function CustomerQrCard({
  value,
  name,
  logoDataUri,
  width = QR_CARD_BASE_WIDTH,
  getRef,
}) {
  const height = Math.round((QR_CARD_BASE_HEIGHT / QR_CARD_BASE_WIDTH) * width);
  const fontFamily = Platform.OS === 'ios' ? 'System' : 'sans-serif';
  const nameLines = useMemo(() => wrapQrLabel(name, 20, 3), [name]);
  const qr = useMemo(() => {
    if (!value) return null;
    try {
      return qrPathFromMatrix(qrMatrixFromValue(value), QR_SIZE);
    } catch (_) {
      return null;
    }
  }, [value]);

  const nameSize = nameLines.length > 2 ? 32 : 40;
  const nameStartY = 860;

  return (
    <Svg
      ref={getRef}
      width={width}
      height={height}
      viewBox={`0 0 ${QR_CARD_BASE_WIDTH} ${QR_CARD_BASE_HEIGHT}`}
    >
      <Rect width={QR_CARD_BASE_WIDTH} height={QR_CARD_BASE_HEIGHT} fill="#EEF2FF" />
      <Rect x={20} y={20} width={680} height={1020} rx={40} fill="#ffffff" />
      <Rect x={20} y={20} width={680} height={236} rx={40} fill="#312E81" />
      <Rect x={20} y={180} width={680} height={76} fill="#312E81" />
      <Rect x={20} y={248} width={680} height={10} fill="#6366F1" />

      <Circle cx={360} cy={108} r={54} fill="#ffffff" />
      {logoDataUri ? (
        <SvgImage
          href={{ uri: logoDataUri }}
          x={320}
          y={68}
          width={80}
          height={80}
          preserveAspectRatio="xMidYMid meet"
        />
      ) : (
        <SvgText
          x={360}
          y={120}
          textAnchor="middle"
          fontSize={36}
          fontWeight="800"
          fontFamily={fontFamily}
          fill="#6366F1"
        >
          G
        </SvgText>
      )}
      <SvgText
        x={360}
        y={198}
        textAnchor="middle"
        fontSize={38}
        fontWeight="800"
        fontFamily={fontFamily}
        fill="#ffffff"
      >
        GasTech
      </SvgText>
      <SvgText
        x={360}
        y={232}
        textAnchor="middle"
        fontSize={16}
        fontWeight="600"
        fontFamily={fontFamily}
        fill="#C7D2FE"
      >
        Customer QR
      </SvgText>

      <Rect
        x={108}
        y={290}
        width={504}
        height={504}
        rx={28}
        fill="#ffffff"
        stroke="#6366F1"
        strokeWidth={5}
      />
      {qr ? (
        <G x={120} y={302}>
          <Rect width={QR_SIZE} height={QR_SIZE} fill="#ffffff" />
          <Path d={qr.path} stroke="#111827" strokeWidth={qr.cellSize} />
        </G>
      ) : null}

      {nameLines.map((line, i) => (
        <SvgText
          key={`${line}-${i}`}
          x={360}
          y={nameStartY + i * (nameSize + 8)}
          textAnchor="middle"
          fontSize={nameSize}
          fontWeight="800"
          fontFamily={fontFamily}
          fill="#312E81"
        >
          {line}
        </SvgText>
      ))}
      <Rect
        x={280}
        y={nameStartY + nameLines.length * (nameSize + 8) + 8}
        width={160}
        height={6}
        rx={3}
        fill="#6366F1"
      />
    </Svg>
  );
}
