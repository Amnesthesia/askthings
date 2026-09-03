import type {
	Card,
	DeckKind,
	DilemmaCard,
	PairCard,
	QuestionCard,
} from "../../src/shared.ts";

/** React twin of src/components/CardBody.astro — Astro components cannot be
 * rendered inside an island, so the card-by-kind switch exists twice. Keep
 * the two in step. */
export default function CardView({
	kind,
	card,
}: {
	kind: DeckKind;
	card: Card;
}) {
	if (kind === "question")
		return <p className="headline">{(card as QuestionCard).text}</p>;
	if (kind === "pair") {
		const { a, b } = card as PairCard;
		return (
			<>
				<p className="headline">Would you rather…</p>
				<div className="pair">
					<div>
						<small>A</small>
						{a}
					</div>
					<div>
						<small>B</small>
						{b}
					</div>
				</div>
			</>
		);
	}
	const d = card as DilemmaCard;
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
