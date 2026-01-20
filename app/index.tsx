import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  BlendMode,
  Canvas,
  ImageFormat,
  notifyChange,
  PaintStyle,
  Path,
  Rect,
  Skia,
  StrokeCap,
  StrokeJoin,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

type Tool = 'pen' | 'eraser' | 'select';
type SelectionRect = { x: number; y: number; width: number; height: number };

type Stroke = {
  path: ReturnType<typeof Skia.Path.Make>;
  strokeWidth: number;
  isEraser: boolean;
};

const BACKGROUND = '#F6F1E7';
const INK = '#1A1A1A';

export default function NoteCanvasScreen() {
  const [tool, setTool] = useState<Tool>('pen');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState<string | null>(null);
  const [responseText, setResponseText] = useState<string | null>(null);
  const [responseVisible, setResponseVisible] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const toolValue = useSharedValue<Tool>('pen');
  const currentPath = useSharedValue(Skia.Path.Make());
  const currentStrokeWidth = useSharedValue(3);
  const currentStrokeColor = useSharedValue(INK);
  const currentBlendMode = useSharedValue<'clear' | 'srcOver'>('srcOver');
  const longPressActivated = useSharedValue(false);
  const selectionStartX = useSharedValue(0);
  const selectionStartY = useSharedValue(0);
  const selectionX = useSharedValue(0);
  const selectionY = useSharedValue(0);
  const selectionW = useSharedValue(0);
  const selectionH = useSharedValue(0);
  const selectionVisible = useSharedValue(0);

  const finalizeStroke = useCallback(
    (svgPath: string, strokeWidth: number, isEraser: boolean) => {
      const path = Skia.Path.MakeFromSVGString(svgPath);
      if (path) {
        setRedoStack([]);
        setStrokes((prev) => [...prev, { path, strokeWidth, isEraser }]);
      }
      currentPath.value.reset();
      notifyChange(currentPath);
    },
    [currentPath]
  );

  const selectTool = useCallback(
    (nextTool: Tool) => {
      setTool(nextTool);
      toolValue.value = nextTool;
    },
    [toolValue]
  );

  const undo = useCallback(() => {
    setStrokes((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRedoStack((stack) => [last, ...stack]);
      return prev.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const [first, ...rest] = prev;
      setStrokes((strokesPrev) => [...strokesPrev, first]);
      return rest;
    });
  }, []);

  const captureSelection = useCallback(
    async (rect: SelectionRect) => {
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const surface = Skia.Surface.MakeOffscreen(width, height);
      if (!surface) return;
      const canvas = surface.getCanvas();
      canvas.clear(Skia.Color(BACKGROUND));
      const paint = Skia.Paint();
      paint.setStyle(PaintStyle.Stroke);
      paint.setStrokeCap(StrokeCap.Round);
      paint.setStrokeJoin(StrokeJoin.Round);
      strokes.forEach((stroke) => {
        paint.setStrokeWidth(stroke.strokeWidth);
        paint.setBlendMode(stroke.isEraser ? BlendMode.Clear : BlendMode.SrcOver);
        paint.setColor(Skia.Color(INK));
        const path = stroke.path.copy();
        path.offset(-rect.x, -rect.y);
        canvas.drawPath(path, paint);
      });
      const image = surface.makeImageSnapshot();
      const base64 = image.encodeToBase64(ImageFormat.PNG);
      const dataUrl = `data:image/png;base64,${base64}`;
      setCapturedImage(dataUrl);

      const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
      if (!apiKey) {
        setCaptureStatus('Missing API key');
        return;
      }
      setCaptureStatus('Sending...');
      try {
        const response = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            input: [
              {
                role: 'user',
                content: [
                  { type: 'input_text', text: 'Analyze this selection.' },
                  { type: 'input_image', image_url: dataUrl },
                ],
              },
            ],
          }),
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText);
        }
        const data = await response.json();
        const outputText =
          data?.output?.[0]?.content?.[0]?.text ??
          data?.output_text ??
          'No response text';
        setResponseText(outputText);
        setCaptureStatus('Sent');
      } catch (error) {
        setCaptureStatus('Send failed');
      }
    },
    [strokes]
  );

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .minDistance(0)
      .enabled(tool !== 'select')
      .onBegin((event) => {
        longPressActivated.value = false;
        const nextPath = Skia.Path.Make();
        nextPath.moveTo(event.x, event.y);
        nextPath.lineTo(event.x + 0.01, event.y + 0.01);
        currentPath.value = nextPath;
        currentStrokeWidth.value = toolValue.value === 'pen' ? 3 : 24;
        currentStrokeColor.value = toolValue.value === 'eraser' ? '#000000' : INK;
        currentBlendMode.value = toolValue.value === 'eraser' ? 'clear' : 'srcOver';
        notifyChange(currentPath);
      })
      .onUpdate((event) => {
        currentPath.value.lineTo(event.x, event.y);
        notifyChange(currentPath);
      })
      .onEnd(() => {
        const svgPath = currentPath.value.toSVGString();
        runOnJS(finalizeStroke)(
          svgPath,
          currentStrokeWidth.value,
          currentBlendMode.value === 'clear'
        );
        if (longPressActivated.value) {
          longPressActivated.value = false;
          runOnJS(selectTool)('pen');
        }
      });

    const longPress = Gesture.LongPress()
      .minDuration(2000)
      .enabled(tool !== 'select')
      .maxDistance(12)
      .onStart((event) => {
        longPressActivated.value = true;
        currentStrokeWidth.value = 24;
        currentStrokeColor.value = '#000000';
        currentBlendMode.value = 'clear';
        const nextPath = Skia.Path.Make();
        nextPath.moveTo(event.x, event.y);
        nextPath.lineTo(event.x + 0.01, event.y + 0.01);
        currentPath.value = nextPath;
        notifyChange(currentPath);
        runOnJS(selectTool)('eraser');
      });

    const selectGesture = Gesture.Pan()
      .minDistance(0)
      .enabled(tool === 'select')
      .onBegin((event) => {
        selectionStartX.value = event.x;
        selectionStartY.value = event.y;
        selectionX.value = event.x;
        selectionY.value = event.y;
        selectionW.value = 0;
        selectionH.value = 0;
        selectionVisible.value = 1;
      })
      .onUpdate((event) => {
        const x0 = selectionStartX.value;
        const y0 = selectionStartY.value;
        const x = Math.min(x0, event.x);
        const y = Math.min(y0, event.y);
        const w = Math.abs(event.x - x0);
        const h = Math.abs(event.y - y0);
        selectionX.value = x;
        selectionY.value = y;
        selectionW.value = w;
        selectionH.value = h;
      })
      .onEnd(() => {
        selectionVisible.value = 0;
        const w = selectionW.value;
        const h = selectionH.value;
        if (w < 2 || h < 2) return;
        runOnJS(setResponseVisible)(true);
        runOnJS(setResponseText)('Sending...');
        runOnJS(captureSelection)({
          x: selectionX.value,
          y: selectionY.value,
          width: w,
          height: h,
        });
      });

    return Gesture.Simultaneous(pan, longPress, selectGesture);
  }, [
    captureSelection,
    finalizeStroke,
    currentBlendMode,
    currentPath,
    currentStrokeColor,
    currentStrokeWidth,
    longPressActivated,
    selectionH,
    selectionStartX,
    selectionStartY,
    selectionVisible,
    selectionW,
    selectionX,
    selectionY,
    selectTool,
    tool,
    toolValue,
  ]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.container}>
        <View style={styles.toolbar}>
          <ToolButton label="Pen" active={tool === 'pen'} onPress={() => selectTool('pen')} />
          <ToolButton label="Eraser" active={tool === 'eraser'} onPress={() => selectTool('eraser')} />
          <ToolButton label="Extract" active={tool === 'select'} onPress={() => selectTool('select')} />
          <ActionButton label="Undo" onPress={undo} disabled={strokes.length === 0} />
          <ActionButton label="Redo" onPress={redo} disabled={redoStack.length === 0} />
          {capturedImage ? <Text style={styles.captureNote}>Captured</Text> : null}
          {captureStatus ? <Text style={styles.captureNote}>{captureStatus}</Text> : null}
        </View>
        <View
          style={styles.canvasWrapper}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setCanvasSize({ width, height });
          }}
        >
          <GestureDetector gesture={gesture}>
            <Canvas style={styles.canvas}>
              <Rect
                x={0}
                y={0}
                width={canvasSize.width}
                height={canvasSize.height}
                color={BACKGROUND}
              />
              {strokes.map((stroke, index) => (
                <Path
                  key={index}
                  path={stroke.path}
                  color={stroke.isEraser ? '#000000' : INK}
                  style="stroke"
                  strokeWidth={stroke.strokeWidth}
                  strokeJoin="round"
                  strokeCap="round"
                  blendMode={stroke.isEraser ? 'clear' : 'srcOver'}
                />
              ))}
              <Path
                path={currentPath}
                color={currentStrokeColor}
                style="stroke"
                strokeWidth={currentStrokeWidth}
                strokeJoin="round"
                strokeCap="round"
                blendMode={currentBlendMode}
              />
              <Rect
                x={selectionX}
                y={selectionY}
                width={selectionW}
                height={selectionH}
                color="rgba(46,35,24,0.12)"
                opacity={selectionVisible}
              />
            </Canvas>
          </GestureDetector>
        </View>
        {responseVisible ? (
          <View style={styles.chatPanel}>
            <Text style={styles.chatTitle}>Response</Text>
            <Text style={styles.chatBody}>{responseText ?? ''}</Text>
            <Pressable style={styles.chatClose} onPress={() => setResponseVisible(false)}>
              <Text style={styles.chatCloseLabel}>Hide</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </GestureHandlerRootView>
  );
}

function ToolButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.toolButton,
        active && styles.toolButtonActive,
        pressed && styles.toolButtonPressed,
      ]}
    >
      <Text style={[styles.toolLabel, active && styles.toolLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function ActionButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionButton,
        disabled && styles.actionButtonDisabled,
        pressed && !disabled && styles.toolButtonPressed,
      ]}
    >
      <Text style={[styles.actionLabel, disabled && styles.actionLabelDisabled]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: BACKGROUND,
  },
  toolbar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 10,
  },
  toolButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#C9B8A2',
    paddingHorizontal: 18,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  toolButtonActive: {
    backgroundColor: '#2B2620',
    borderColor: '#2B2620',
  },
  toolButtonPressed: {
    transform: [{ scale: 0.98 }],
  },
  toolLabel: {
    color: '#2B2620',
    fontSize: 16,
    letterSpacing: 0.2,
  },
  toolLabelActive: {
    color: '#F6F1E7',
  },
  captureNote: {
    color: '#7C6A56',
    fontSize: 12,
    letterSpacing: 0.3,
  },
  chatPanel: {
    position: 'absolute',
    right: 16,
    top: 76,
    bottom: 16,
    width: 260,
    backgroundColor: '#F7F0E6',
    borderRadius: 18,
    padding: 14,
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  chatTitle: {
    fontSize: 18,
    color: '#2B2620',
    marginBottom: 10,
  },
  chatBody: {
    fontSize: 14,
    color: '#3D342B',
    marginBottom: 16,
    lineHeight: 20,
  },
  chatClose: {
    alignSelf: 'flex-end',
    backgroundColor: '#2B2620',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  chatCloseLabel: {
    color: '#F6F1E7',
    fontSize: 13,
    letterSpacing: 0.3,
  },
  actionButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D5C7B2',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  actionButtonDisabled: {
    borderColor: '#E1D7C7',
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  actionLabel: {
    color: '#5C4F3F',
    fontSize: 14,
    letterSpacing: 0.2,
  },
  actionLabelDisabled: {
    color: '#A89B88',
  },
  canvasWrapper: {
    flex: 1,
    overflow: 'hidden',
  },
  canvas: {
    flex: 1,
  },
});
