import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Canvas, notifyChange, Path, Rect, Skia } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

type Tool = 'pen' | 'eraser';

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
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const toolValue = useSharedValue<Tool>('pen');
  const currentPath = useSharedValue(Skia.Path.Make());
  const currentStrokeWidth = useSharedValue(3);
  const currentStrokeColor = useSharedValue(INK);
  const currentBlendMode = useSharedValue<'clear' | 'srcOver'>('srcOver');
  const longPressActivated = useSharedValue(false);

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

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .minDistance(0)
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
      .minDuration(250)
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
    return Gesture.Simultaneous(pan, longPress);
  }, [
    finalizeStroke,
    currentBlendMode,
    currentPath,
    currentStrokeColor,
    currentStrokeWidth,
    longPressActivated,
    selectTool,
    toolValue,
  ]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.container}>
        <View style={styles.toolbar}>
          <ToolButton label="Pen" active={tool === 'pen'} onPress={() => selectTool('pen')} />
          <ToolButton label="Eraser" active={tool === 'eraser'} onPress={() => selectTool('eraser')} />
          <ActionButton label="Undo" onPress={undo} disabled={strokes.length === 0} />
          <ActionButton label="Redo" onPress={redo} disabled={redoStack.length === 0} />
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
            </Canvas>
          </GestureDetector>
        </View>
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
