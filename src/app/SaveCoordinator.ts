/** SaveCoordinator 与 GameStore 共用实现模块；写能力不会从此文件导出。 */
export { SaveCoordinator } from "./GameStore";
export type {
  SaveCandidate,
  SaveCandidateKind,
  SaveCandidateOptions,
  SaveCoordinatorFailure,
  SaveCoordinatorOptions,
  SaveCoordinatorResult,
  SaveCoordinatorSuccess,
  SaveRepositoryWriter,
} from "./GameStore";
