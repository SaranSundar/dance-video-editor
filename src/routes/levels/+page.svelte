<script lang="ts">
	let expandedSection = $state<string | null>(null);

	function toggle(section: string) {
		expandedSection = expandedSection === section ? null : section;
	}

	const moveDifficulty = [
		{ num: 1, label: 'White Belt', color: '#e4e4e7', moves: 'Basic step, forward and back, rotating basic 180, out-in-out turns, closed position, cross over basic, sway, 3x3 combos' },
		{ num: 2, label: 'Yellow Belt', color: '#facc15', moves: 'Hammerlock, cuddle, sweetheart, cuddle swing, sweetheart swing, angel steps, separation basic, swing basic, box step, 4x4 combos' },
		{ num: 3, label: 'Orange Belt', color: '#fb923c', moves: 'Cross body lead, swing turns, madrid step, outside turns, constant connection, tosses and chops, collect basic, 5x5 combos' },
		{ num: 4, label: 'Green 1-2', color: '#4ade80', moves: 'Shadow entrances (rompe, cuddle), dips/cambre, cuddle block, delayed turn, swivels, open cross body lead, rock step/twist, madrid variations' },
		{ num: 5, label: 'Green 3+', color: '#22d3ee', moves: 'Body rolls in partnerwork, snake/reverse snake, isolations in pattern (rib, chest, shoulder, hip), full embrace transitions, head roll' },
	];

	const followLevel = [
		{ num: 1, label: 'White Belt', color: '#e4e4e7', skills: 'Basic, out-in-out turns, basic frame (lats down, elbow off ribs), cross over basic' },
		{ num: 2, label: 'Yellow Belt', color: '#facc15', skills: 'Hammerlock, sharper turns, swing basic footwork, box step, cuddle/sweetheart swing footwork, triple rocks with ribs' },
		{ num: 3, label: 'Orange Belt', color: '#fb923c', skills: 'Cross body lead footwork, madrid step footwork, rotating in place, active styling, bachata hips and ribs' },
		{ num: 4, label: 'Green 1-2', color: '#4ade80', skills: 'Rompe footwork, cuddle block footwork, dips/cambre technique, shadow strong basics, swivels footwork, modern frame' },
		{ num: 5, label: 'Green 3+', color: '#22d3ee', skills: 'Sensual frame, body roll, reverse body roll, all isolations (rib, chest, shoulder, hip), figure 8 hips, delayed hips' },
	];

	const leadMastery = [
		{ num: 1, label: 'Learning', desc: 'Need follow to actively help you through it', follow: '5 - Green 3+', followClass: 'f5' },
		{ num: 2, label: 'Drilling', desc: 'Practicing mechanics with a Green Belt follow doing some of the work', follow: '4 - Green 1-2', followClass: 'f4' },
		{ num: 3, label: 'Leading', desc: 'Works with an Orange Belt follow - clear signals, correct timing', follow: '3 - Orange', followClass: 'f3', milestone: true },
		{ num: 4, label: 'Comfortable', desc: 'Works with a Yellow Belt follow who doesn\'t know the pattern', follow: '2 - Yellow', followClass: 'f2' },
		{ num: 5, label: 'Effortless', desc: 'Works with a White Belt follow - just a basic and a frame', follow: '1 - Any', followClass: 'f1' },
		{ num: 6, label: 'Musical', desc: 'Own the move - place it in the song, adapt timing, recover from hiccups', follow: '1 - Any', followClass: 'f1', special: true },
	];

	const examples = [
		{ move: 'Basic step', diff: 1, lead: '3 Leading', minFollow: '3 Orange', fc: 'f3' },
		{ move: 'Basic step', diff: 1, lead: '5 Effortless', minFollow: '1 Any', fc: 'f1' },
		{ move: 'Hammerlock', diff: 2, lead: '1 Learning', minFollow: '5 Teacher', fc: 'f5' },
		{ move: 'Hammerlock', diff: 2, lead: '4 Comfortable', minFollow: '2 Yellow', fc: 'f2' },
		{ move: 'Cross body lead', diff: 3, lead: '2 Drilling', minFollow: '4 Green', fc: 'f4' },
		{ move: 'Cross body lead', diff: 3, lead: '5 Effortless', minFollow: '1 Any', fc: 'f1' },
		{ move: 'Shadow entrance', diff: 4, lead: '1 Learning', minFollow: '5 Teacher', fc: 'f5' },
		{ move: 'Shadow entrance', diff: 4, lead: '4 Comfortable', minFollow: '3 Orange', fc: 'f3', floor: true },
		{ move: 'Dip/cambre', diff: 4, lead: '5 Effortless', minFollow: '3 Orange', fc: 'f3', floor: true },
		{ move: 'Body roll pattern', diff: 5, lead: '3 Leading', minFollow: '4 Green', fc: 'f4', floor: true },
		{ move: 'Body roll pattern', diff: 5, lead: '6 Musical', minFollow: '4 Green', fc: 'f4', floor: true },
	];

	const floors = [
		{ moves: 'Basic step, turns', floor: 1, why: 'Pure lead', color: '#4ade80' },
		{ moves: 'Cuddle, sweetheart', floor: 2, why: 'Follow needs to know the position', color: '#facc15' },
		{ moves: 'Dips/cambre, shadow', floor: 3, why: 'Follow needs body control and trust', color: '#fb923c' },
		{ moves: 'Body rolls, snake', floor: 4, why: 'Follow must know the isolation', color: '#f87171' },
	];
</script>

<div class="page">
	<div class="hero">
		<a href="/" class="back">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="15 18 9 12 15 6" />
			</svg>
			Back
		</a>
		<div class="hero-content">
			<h1>Level System</h1>
			<p class="hero-question">"What's the least experienced follow I can lead this move with?"</p>
			<div class="hero-pills">
				<span class="hero-pill">Move Difficulty 1-5</span>
				<span class="hero-pill">Follow Level 1-5</span>
				<span class="hero-pill">Lead Mastery 1-6</span>
			</div>
		</div>
	</div>

	<!-- Move Difficulty -->
	<section class="section">
		<button class="section-header" onclick={() => toggle('move')}>
			<div class="section-title">
				<h2>Move Difficulty</h2>
				<span class="badge">1-5</span>
			</div>
			<span class="section-desc">Fixed property of the move</span>
			<svg class="chevron" class:open={expandedSection === 'move'} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
		</button>
		{#if expandedSection === 'move'}
			<div class="section-body">
				{#each moveDifficulty as level}
					<div class="card">
						<div class="card-num" style="color: {level.color}">{level.num}</div>
						<div class="card-content">
							<div class="card-label" style="color: {level.color}">{level.label}</div>
							<div class="card-detail">{level.moves}</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Follow Level -->
	<section class="section">
		<button class="section-header" onclick={() => toggle('follow')}>
			<div class="section-title">
				<h2>Follow Level</h2>
				<span class="badge">1-5</span>
			</div>
			<span class="section-desc">Assess in the first 8 counts</span>
			<svg class="chevron" class:open={expandedSection === 'follow'} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
		</button>
		{#if expandedSection === 'follow'}
			<div class="section-body">
				{#each followLevel as level}
					<div class="card">
						<div class="card-num" style="color: {level.color}">{level.num}</div>
						<div class="card-content">
							<div class="card-label" style="color: {level.color}">{level.label}</div>
							<div class="card-detail">{level.skills}</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Lead Mastery -->
	<section class="section">
		<button class="section-header" onclick={() => toggle('lead')}>
			<div class="section-title">
				<h2>Lead Mastery</h2>
				<span class="badge">1-6</span>
			</div>
			<span class="section-desc">Your ability per move - changes as you practice</span>
			<svg class="chevron" class:open={expandedSection === 'lead'} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
		</button>
		{#if expandedSection === 'lead'}
			<div class="section-body">
				{#each leadMastery as level}
					<div class="card" class:milestone={level.milestone} class:special={level.special}>
						<div class="card-num">{level.num}</div>
						<div class="card-content">
							<div class="card-top">
								<span class="card-label">{level.label}</span>
								<span class="follow-tag {level.followClass}">{level.follow}</span>
							</div>
							<div class="card-detail">{level.desc}</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- The Relationship -->
	<section class="section">
		<button class="section-header" onclick={() => toggle('relationship')}>
			<div class="section-title">
				<h2>The Relationship</h2>
			</div>
			<span class="section-desc">How the three systems connect</span>
			<svg class="chevron" class:open={expandedSection === 'relationship'} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
		</button>
		{#if expandedSection === 'relationship'}
			<div class="section-body">
				<div class="formula-card">
					<span class="formula-label">Min Follow</span>
					<span class="formula-eq">=</span>
					<span class="formula-val">6 - Lead Mastery</span>
				</div>

				<div class="rel-list">
					{#each leadMastery as level}
						<div class="rel-item">
							<span class="rel-lead">{level.num} {level.label}</span>
							<div class="rel-arrow">
								<svg width="20" height="12" viewBox="0 0 20 12"><path d="M0 6h16M12 1l5 5-5 5" fill="none" stroke="#3f3f46" stroke-width="1.5"/></svg>
							</div>
							<span class="follow-tag {level.followClass}">{level.follow}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</section>

	<!-- Follow Floor -->
	<section class="section">
		<button class="section-header" onclick={() => toggle('floor')}>
			<div class="section-title">
				<h2>Follow Floor</h2>
			</div>
			<span class="section-desc">Minimum follow level regardless of lead skill</span>
			<svg class="chevron" class:open={expandedSection === 'floor'} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
		</button>
		{#if expandedSection === 'floor'}
			<div class="section-body">
				{#each floors as f}
					<div class="floor-card">
						<div class="floor-num" style="color: {f.color}">{f.floor}</div>
						<div class="floor-content">
							<div class="floor-moves">{f.moves}</div>
							<div class="floor-why">{f.why}</div>
						</div>
					</div>
				{/each}

				<div class="formula-card small">
					<span class="formula-label">Effective min</span>
					<span class="formula-eq">=</span>
					<span class="formula-val">max(floor, 6 - lead)</span>
				</div>
			</div>
		{/if}
	</section>

	<!-- Examples -->
	<section class="section">
		<button class="section-header" onclick={() => toggle('examples')}>
			<div class="section-title">
				<h2>Examples</h2>
			</div>
			<span class="section-desc">The system in action</span>
			<svg class="chevron" class:open={expandedSection === 'examples'} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
		</button>
		{#if expandedSection === 'examples'}
			<div class="section-body">
				{#each examples as ex}
					<div class="ex-card">
						<div class="ex-move">
							<span class="ex-name">{ex.move}</span>
							<span class="ex-diff">Diff {ex.diff}</span>
						</div>
						<div class="ex-bottom">
							<span class="ex-lead">{ex.lead}</span>
							<svg width="16" height="10" viewBox="0 0 16 10"><path d="M0 5h12M9 1l4 4-4 4" fill="none" stroke="#3f3f46" stroke-width="1.5"/></svg>
							<span class="follow-tag {ex.fc}">{ex.minFollow}{ex.floor ? ' (floor)' : ''}</span>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- At a Social / With Teacher -->
	<section class="section">
		<button class="section-header" onclick={() => toggle('practice')}>
			<div class="section-title">
				<h2>In Practice</h2>
			</div>
			<span class="section-desc">At socials and with your teacher</span>
			<svg class="chevron" class:open={expandedSection === 'practice'} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
		</button>
		{#if expandedSection === 'practice'}
			<div class="section-body">
				<h3 class="sub-heading">At a Social</h3>
				<div class="step-list">
					<div class="step">
						<div class="step-num">1</div>
						<div class="step-text"><strong>Read the follow</strong> in the first 8 counts. Basic, a turn, check the frame.</div>
					</div>
					<div class="step">
						<div class="step-num">2</div>
						<div class="step-text"><strong>Pick your moves.</strong> Only use moves where your min follow is at or below their level.</div>
					</div>
					<div class="step">
						<div class="step-num">3</div>
						<div class="step-text"><strong>Track progress.</strong> "Hammerlock went from 2 to 3" = you can now bring it to socials with Orange Belt follows.</div>
					</div>
				</div>

				<h3 class="sub-heading">With Your Teacher</h3>
				<p class="teacher-intro">Your teacher is a level 5 follow. Everything is possible. Push each move's mastery up.</p>
				<div class="flow">
					{#each leadMastery as level}
						<div class="flow-item" class:flow-milestone={level.milestone} class:flow-special={level.special}>
							<div class="flow-bar" style="width: {(level.num / 6) * 100}%"></div>
							<div class="flow-content">
								<span class="flow-num">{level.num}</span>
								<span class="flow-label">{level.label}</span>
								{#if level.milestone}
									<span class="flow-badge">Social ready</span>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</section>
</div>

<style>
	.page {
		max-width: 680px;
		margin: 0 auto;
		padding-bottom: 80px;
	}

	/* Hero */
	.hero {
		margin-bottom: 28px;
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: #52525b;
		text-decoration: none;
		font-size: 13px;
		font-weight: 500;
		transition: color 0.15s;
	}

	.back:hover { color: #a1a1aa; }

	.hero-content {
		margin-top: 16px;
	}

	h1 {
		font-size: 28px;
		font-weight: 800;
		letter-spacing: -0.04em;
		margin: 0 0 8px;
		background: linear-gradient(135deg, #e4e4e7, #818cf8);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.hero-question {
		color: #a1a1aa;
		font-size: 15px;
		font-style: italic;
		margin: 0 0 16px;
		line-height: 1.4;
	}

	.hero-pills {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.hero-pill {
		background: rgba(99, 102, 241, 0.1);
		border: 1px solid rgba(99, 102, 241, 0.2);
		color: #a5b4fc;
		font-size: 11px;
		font-weight: 600;
		padding: 4px 12px;
		border-radius: 20px;
		letter-spacing: 0.02em;
	}

	/* Sections */
	.section {
		margin-bottom: 8px;
	}

	.section-header {
		width: 100%;
		background: #18181b;
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 12px;
		padding: 16px 18px;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 12px;
		transition: all 0.15s;
		text-align: left;
		font-family: inherit;
		color: inherit;
	}

	.section-header:hover {
		background: #1c1c20;
		border-color: rgba(255, 255, 255, 0.1);
	}

	.section-title {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	h2 {
		font-size: 15px;
		font-weight: 600;
		margin: 0;
		color: #e4e4e7;
		letter-spacing: -0.01em;
	}

	.badge {
		background: rgba(99, 102, 241, 0.15);
		color: #818cf8;
		font-size: 10px;
		font-weight: 700;
		padding: 2px 7px;
		border-radius: 8px;
	}

	.section-desc {
		color: #52525b;
		font-size: 12px;
		flex: 1;
	}

	.chevron {
		color: #3f3f46;
		transition: transform 0.2s;
		flex-shrink: 0;
	}

	.chevron.open {
		transform: rotate(180deg);
	}

	.section-body {
		padding: 12px 4px 8px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	/* Cards */
	.card {
		display: flex;
		gap: 14px;
		padding: 14px 16px;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.04);
		border-radius: 10px;
		transition: border-color 0.15s;
	}

	.card:hover {
		border-color: rgba(255, 255, 255, 0.08);
	}

	.card.milestone {
		border-color: rgba(34, 197, 94, 0.3);
		background: rgba(34, 197, 94, 0.04);
	}

	.card.special {
		border-color: rgba(99, 102, 241, 0.3);
		background: rgba(99, 102, 241, 0.04);
	}

	.card-num {
		font-size: 22px;
		font-weight: 800;
		color: #818cf8;
		line-height: 1;
		min-width: 28px;
		padding-top: 2px;
	}

	.card-content {
		flex: 1;
		min-width: 0;
	}

	.card-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 4px;
	}

	.card-label {
		font-size: 13px;
		font-weight: 600;
		color: #e4e4e7;
	}

	.card-detail {
		font-size: 12px;
		color: #71717a;
		line-height: 1.5;
	}

	/* Follow tags */
	.follow-tag {
		font-size: 11px;
		font-weight: 600;
		padding: 3px 9px;
		border-radius: 8px;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.follow-tag.f1 { background: rgba(34, 197, 94, 0.12); color: #4ade80; }
	.follow-tag.f2 { background: rgba(250, 204, 21, 0.12); color: #facc15; }
	.follow-tag.f3 { background: rgba(251, 146, 60, 0.12); color: #fb923c; }
	.follow-tag.f4 { background: rgba(239, 68, 68, 0.12); color: #f87171; }
	.follow-tag.f5 { background: rgba(168, 85, 247, 0.12); color: #c084fc; }

	/* Formula */
	.formula-card {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 16px 20px;
		background: rgba(99, 102, 241, 0.06);
		border: 1px solid rgba(99, 102, 241, 0.15);
		border-radius: 10px;
		flex-wrap: wrap;
	}

	.formula-card.small {
		padding: 12px 16px;
		margin-top: 4px;
	}

	.formula-label {
		font-size: 13px;
		font-weight: 600;
		color: #e4e4e7;
	}

	.formula-eq { color: #52525b; }

	.formula-val {
		font-size: 14px;
		font-weight: 700;
		color: #818cf8;
		font-family: 'SF Mono', 'Fira Code', monospace;
	}

	/* Relationship */
	.rel-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.rel-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 14px;
		background: rgba(255, 255, 255, 0.02);
		border-radius: 8px;
	}

	.rel-lead {
		font-size: 13px;
		color: #a1a1aa;
		min-width: 120px;
		font-weight: 500;
	}

	.rel-arrow {
		flex-shrink: 0;
	}

	/* Floor cards */
	.floor-card {
		display: flex;
		gap: 14px;
		padding: 12px 16px;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.04);
		border-radius: 10px;
	}

	.floor-num {
		font-size: 22px;
		font-weight: 800;
		min-width: 28px;
		line-height: 1;
		padding-top: 2px;
	}

	.floor-content { flex: 1; }

	.floor-moves {
		font-size: 13px;
		font-weight: 500;
		color: #e4e4e7;
		margin-bottom: 2px;
	}

	.floor-why {
		font-size: 12px;
		color: #52525b;
	}

	/* Example cards */
	.ex-card {
		padding: 12px 16px;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.04);
		border-radius: 10px;
	}

	.ex-move {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 6px;
	}

	.ex-name {
		font-size: 13px;
		font-weight: 600;
		color: #e4e4e7;
	}

	.ex-diff {
		font-size: 11px;
		color: #52525b;
		font-weight: 500;
	}

	.ex-bottom {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.ex-lead {
		font-size: 12px;
		color: #71717a;
	}

	/* Steps */
	.sub-heading {
		font-size: 14px;
		font-weight: 600;
		color: #e4e4e7;
		margin: 12px 0 8px;
		letter-spacing: -0.01em;
	}

	.sub-heading:first-child {
		margin-top: 0;
	}

	.step-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.step {
		display: flex;
		gap: 14px;
		align-items: start;
		padding: 12px 16px;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.04);
		border-radius: 10px;
	}

	.step-num {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: rgba(99, 102, 241, 0.15);
		color: #818cf8;
		font-size: 12px;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.step-text {
		font-size: 13px;
		color: #a1a1aa;
		line-height: 1.5;
	}

	.step-text strong { color: #e4e4e7; }

	/* Teacher flow */
	.teacher-intro {
		font-size: 13px;
		color: #71717a;
		margin: 0 0 12px;
	}

	.flow {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.flow-item {
		position: relative;
		padding: 10px 16px;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.04);
		border-radius: 10px;
		overflow: hidden;
	}

	.flow-item.flow-milestone {
		border-color: rgba(34, 197, 94, 0.3);
	}

	.flow-item.flow-special {
		border-color: rgba(99, 102, 241, 0.3);
	}

	.flow-bar {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		background: linear-gradient(90deg, rgba(99, 102, 241, 0.08), rgba(99, 102, 241, 0.03));
		pointer-events: none;
	}

	.flow-content {
		position: relative;
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.flow-num {
		font-size: 16px;
		font-weight: 800;
		color: #818cf8;
		min-width: 20px;
	}

	.flow-label {
		font-size: 13px;
		font-weight: 500;
		color: #a1a1aa;
	}

	.flow-badge {
		font-size: 10px;
		font-weight: 700;
		color: #4ade80;
		background: rgba(34, 197, 94, 0.12);
		padding: 2px 8px;
		border-radius: 8px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	/* Mobile */
	@media (max-width: 640px) {
		h1 { font-size: 24px; }

		.section-header {
			padding: 14px 14px;
			flex-wrap: wrap;
		}

		.section-desc {
			order: 3;
			width: 100%;
			margin-top: 2px;
		}

		.rel-item {
			flex-wrap: wrap;
			gap: 6px;
		}

		.rel-lead {
			min-width: unset;
		}

		.ex-bottom {
			flex-wrap: wrap;
		}
	}
</style>
