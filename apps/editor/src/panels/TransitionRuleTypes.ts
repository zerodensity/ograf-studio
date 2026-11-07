import type { ComponentDefinition, TransitionLogicDefinition } from '@ograf-editor/scene-model';
import type { ProjectSetDocument } from '../state/projectSet';
import type { TransitionBehaviorPhase } from '../state/transitionBehaviors';

export interface TransitionRuleEditorProps {
  projectSet: ProjectSetDocument;
  definition: TransitionLogicDefinition;
  components: ComponentDefinition[];
  activeTemplateId?: string;
  edit: (change: (definition: TransitionLogicDefinition) => void) => void;
  disabled?: boolean;
  onPreview: (phase: TransitionBehaviorPhase, stateId: string, contextStateIds?: string[]) => void;
  previewDisabledReason?: string;
  onShowAdvanced?: (section: 'states' | 'routes' | 'shared' | 'transitions') => void;
  authoringRequest?: { id: string; phase: TransitionBehaviorPhase };
}
