import type {
	Card,
	DeckKind,
	DilemmaCard,
	ImprovCard,
	PairCard,
	QuestionCard,
} from "../../src/shared.ts";

/** React twin of src/components/CardBody.astro — Astro components cannot be
 * rendered inside an island, so the card-by-kind switch exists twice. Keep
 * the two in step. */
export default function CardView({
	kind,
	card,
	compact = false,
	onExpand,
}: {
	kind: DeckKind;
	card: Card;
	/** Dilemmas: title and question only, with a button to read the scenario. */
	compact?: boolean;
	onExpand?: () => void;
}) {
	if (kind === "question")
		return <p className="headline">{(card as QuestionCard).text}</p>;
	if (kind === "improv") {
		const { word, slot } = card as ImprovCard;
		return (
			<>
				<p className="headline">{word}</p>
				<small className="slot-label">{slot}</small>
			</>
		);
	}
	if (kind === "pair") {
		const { a, b } = card as PairCard;
		return (
			<>
				<p className="headline">Would you rather…</p>
				<div className="pair">
					<div>{a}</div>
					<div className="pair-or">or</div>
					<div>{b}</div>
				</div>
			</>
		);
	}
	const d = card as DilemmaCard;
	if (compact) {
		return (
			<>
				<p className="headline">{d.title}</p>
				<p>
					<strong>{d.dilemma}</strong>
				</p>
				<button type="button" className="read-more" onClick={onExpand}>
					Read the scenario
				</button>
			</>
		);
	}
	return (
		<>
			<p className="headline">{d.title}</p>
			<p>{d.setup}</p>
			<p>
				<strong>{d.dilemma}</strong>
			</p>
			<div className="probes">
				<h3>Then ask</h3>
				<ul>
					{d.probes.map((probe) => (
						<li key={probe}>{probe}</li>
					))}
				</ul>
			</div>
		</>
	);
}
