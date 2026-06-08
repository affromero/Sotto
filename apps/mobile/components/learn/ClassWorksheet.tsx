/**
 * components/learn/ClassWorksheet.tsx
 *
 * Read-only native render of a ClassDocument worksheet.
 * Shows sections with MC checkbox rows and speaking prompts.
 * When isPencilKitAvailable, overlays a PencilKitCanvas per section
 * and saves strokes via saveInk on change.
 */

import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { ClassDocument, ClassDocumentSection } from '@sotto/shared';
import {
  isPencilKitAvailable,
  PencilKitCanvas,
} from '../../modules/sotto-pencilkit';
import { saveInk } from '../../lib/learn-api';

// ---------------------------------------------------------------------------
// Single MC question row (read-only checkbox style)
// ---------------------------------------------------------------------------

function CheckboxRow({ label, letter }: { label: string; letter: string }) {
  return (
    <View style={styles.checkboxRow}>
      <View style={styles.checkboxBox}>
        <Text style={styles.checkboxLetter}>{letter}</Text>
      </View>
      <Text style={styles.checkboxLabel}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Section renderer
// ---------------------------------------------------------------------------

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function WorksheetSection({
  section,
  classId,
}: {
  section: ClassDocumentSection;
  classId: string;
}) {
  const handleInkChange = (base64: string) => {
    saveInk(classId, section.id, base64).catch(() => {
      // silent — ink is best-effort
    });
  };

  return (
    <View style={styles.sectionContainer}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionSkill}>{section.skill}</Text>
        <Text style={styles.sectionTitle}>{section.title}</Text>
        {section.instructions ? (
          <Text style={styles.sectionInstructions}>{section.instructions}</Text>
        ) : null}
      </View>

      {/* MC questions */}
      {section.questions.map((q, qi) => (
        <View key={q.id} style={styles.questionBlock}>
          {q.passageRef ? (
            <Text style={styles.passageRef}>{q.passageRef}</Text>
          ) : null}
          <Text style={styles.questionText}>
            {qi + 1}. {q.question}
          </Text>
          {q.options.map((opt, oi) => (
            <CheckboxRow
              key={oi}
              letter={LETTERS[oi] ?? String(oi + 1)}
              label={opt}
            />
          ))}
          {q.correctIndex != null && (
            <Text style={styles.answerKey}>
              Answer: {LETTERS[q.correctIndex] ?? String(q.correctIndex + 1)}
              {q.explanation ? ` — ${q.explanation}` : ''}
            </Text>
          )}
        </View>
      ))}

      {/* Speaking prompts */}
      {section.prompts.map((p, pi) => (
        <View key={p.id} style={styles.promptBlock}>
          <Text style={styles.promptNumber}>Prompt {pi + 1}</Text>
          <Text style={styles.promptPhrase}>{p.targetPhrase}</Text>
          <Text style={styles.promptTranslation}>{p.translation}</Text>
          {p.ipa ? <Text style={styles.promptIpa}>[{p.ipa}]</Text> : null}
        </View>
      ))}

      {/* PencilKit ink overlay */}
      {isPencilKitAvailable && (
        <PencilKitCanvas
          style={StyleSheet.absoluteFillObject}
          onChange={handleInkChange}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ClassWorksheetProps {
  document: ClassDocument;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ClassWorksheet({ document }: ClassWorksheetProps) {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.docTitle}>{document.title}</Text>
      <View style={styles.docMeta}>
        <Text style={styles.metaChip}>{document.level}</Text>
        <Text style={styles.metaChip}>{document.targetLang}</Text>
      </View>
      <Text style={styles.objective}>{document.objective}</Text>

      {document.sections.map((section) => (
        <WorksheetSection
          key={section.id}
          section={section}
          classId={document.classId}
        />
      ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 2,
    gap: spacing.lg,
  },
  docTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 24,
    color: colors.textPrimary,
    lineHeight: 32,
  },
  docMeta: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  metaChip: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent,
    backgroundColor: colors.accentLighter,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  objective: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  sectionContainer: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
    overflow: 'hidden',
  },
  sectionHeader: {
    gap: spacing.xs,
  },
  sectionSkill: {
    fontFamily: typography.fontBody,
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 18,
    color: colors.textPrimary,
  },
  sectionInstructions: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  questionBlock: {
    gap: spacing.xs,
  },
  passageRef: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontStyle: 'italic',
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.xs,
  },
  questionText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 22,
    marginBottom: spacing.xs,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 4,
    minHeight: 32,
  },
  checkboxBox: {
    width: 22,
    height: 22,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.xs,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  checkboxLetter: {
    fontFamily: typography.fontBody,
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  checkboxLabel: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textPrimary,
    flex: 1,
    lineHeight: 20,
  },
  answerKey: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.success,
    marginTop: spacing.xs,
  },
  promptBlock: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  promptNumber: {
    fontFamily: typography.fontBody,
    fontSize: 11,
    fontWeight: '600',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  promptPhrase: {
    fontFamily: typography.fontHeading,
    fontSize: 18,
    color: colors.textPrimary,
    lineHeight: 26,
  },
  promptTranslation: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  promptIpa: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textTertiary,
    fontStyle: 'italic',
  },
});
