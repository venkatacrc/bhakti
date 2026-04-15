#!/usr/bin/env python3
"""One-off generator for hanuman_bahuk.html — run from repo root."""
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / ".pip_indic"))
from indic_transliteration.sanscript import transliterate, DEVANAGARI, TELUGU, ITRANS

_here = pathlib.Path(__file__).resolve().parent
SRC = _here / "stotranidhi_hanuman_bahuk_source.txt"
if not SRC.exists():
    SRC = pathlib.Path("/Users/v0c03vo/.cursor/projects/Users-v0c03vo-code-bhakti/agent-tools/545ada90-f390-48d2-b83f-18a96b19682c.txt")

raw = SRC.read_text(encoding="utf-8")
chunk = raw.split("– छप्पय –")[1].split("इति शुभम्")[0]
verses_raw = []
for line in chunk.split("\n"):
    line = line.strip()
    if not line or line.startswith("–"):
        continue
    if re.search(r"॥\s*[०-९]+\s*॥\s*$", line):
        verses_raw.append(line)

assert len(verses_raw) == 44, len(verses_raw)

METER_MARKS = [
    (0, "Chhappaya (छप्पय)"),
    (2, "Jhoolna (झूलना)"),
    (3, "Ghanakshari (घनाक्षरी)"),
    (15, "Savaiya (सवैया)"),
    (19, "Ghanakshari (घनाक्षरी)"),
    (35, "Savaiya (सवैया)"),
    (36, "Ghanakshari (घनाक्षरी)"),
]


def strip_final_marker(s: str) -> tuple[str, str]:
    m = re.search(r"॥\s*([०-९]+)\s*॥\s*$", s)
    if not m:
        return s, ""
    num = m.group(1)
    body = s[: m.start()].strip()
    return body, num


def format_hindi_br(s: str) -> str:
    s = s.replace(" । ", " ।<br>")
    s = s.replace(" ॥ ", " ॥<br>")
    return s


def format_telugu_br(s: str) -> str:
    # Use Devanagari danda after transliteration (clearer than wrong legacy Telugu codepoints)
    s = s.replace(" । ", " ।<br>").replace(" ॥ ", " ॥<br>")
    return s


DEV_NUM = str.maketrans("०१२३४५६७८९", "0123456789")
TEL_DIG = "\u0C66\u0C67\u0C68\u0C69\u0C6A\u0C6B\u0C6C\u0C6D\u0C6E\u0C6F"
TEL_NUM = str.maketrans("०१२३४५६७८९", TEL_DIG)


def num_tel(n: str) -> str:
    return n.translate(TEL_NUM)


def telugu_cleanup(t: str) -> str:
    t = t.replace("\u094d", "")  # remove stray halant if any
    t = t.replace("సों", "సోం")
    t = t.replace("तेँ", "తేం")  # if devanagari leaked
    # Devanagari danda → Telugu danda (avoid mixed script in Telugu column)
    return t


def transl_tel(s: str) -> str:
    s = re.sub(r"॥\s*[०-९]+\s*॥\s*$", "", s).strip()
    out = transliterate(s, DEVANAGARI, TELUGU)
    return telugu_cleanup(out)


def transl_en(s: str) -> str:
    s = re.sub(r"॥\s*[०-९]+\s*॥\s*$", "", s).strip()
    return transliterate(s, DEVANAGARI, ITRANS)


# Concise Telugu + English meanings (aligned with traditional themes)
ME_TE = [
    "సముద్రాన్ని దాటి, సీత శోకాన్ని పోగొట్టి, బాలార్కుని మింగిన శరీరము; విశాల భుజములు, భయంకర రూపము—కాలునకు కూడా కాలము. లోకములను కాల్చి లంకను కాల్చని నిర్భయుడవు; రాక్షస బలగర్వమును తొలగించు పవనుని కుమారుడవు. తులసీదాసు చెప్పునట్టి సులభ సేవ్యుడవు—గుణగానము, నమస్కారము, స్మరణ, జపము చేసిన యే కఠిన సంకటమును నశింపజేయువాడవు.",
    "బంగారు పర్వతముల వంటి, కోటి సూర్యుల యవ్వన తేజస్సుతో నిండిన శరీరము; విశాల వక్షము, భయంకర భుజదండములు, వజ్రసమాన నఖములు. పింగాక్షుడవు, భ్రుకుటి రౌద్రము, నోట నాలుగు దంతములు; కపీశ్వర కేశములు, లంగూర రూపము—శత్రు సమూహ బలమును భస్మించువాడవు. ఎవరి హృదయమందు మారుతి పుత్రుని భయంకర మూర్తి నివసించునో, వానికి శాంతి పాపములు స్వప్నమందును సమీపింపవు.",
    "ఐదు ముఖములు, ఆరు ముఖములు, భృగు మొదలైన శిరస్సులతో అసుర దేవ సైన్యములను జయించు సమరోన్ముఖ వీరుడవు; వంకర శరీరముగల వీరుడవు, వేదములచే స్తుతింపబడు పైజపూరు. రఘునాథుని గుణములకు నాథుడవు, జగద్జలధిని నింపిన బలము గలవాడవు; శత్రు సమూహములను అణచివేయుటకు తులసీకు తోడెవరు—వాయుపుత్రుడవు, రఘుకుల పుత్రుడవు, రౌద్ర స్వభావుడవు.",
    "బాలునివలె సూర్యుని చూచి హనుమాన్ ఆకాశమునకు పోయెను; మార్గము తప్పకుండా కపి బాలకుని క్రీడ వంటిది. లోకపాలకులు హరి హరి బ్రహ్మలు ఆశ్చర్యపడి చూచిరి. బలము, వీరరసము, ధైర్యము, సాహసము—తులసీ శరీరమున ధరించి సర్వశ్రేష్ఠత్వము చూపెను.",
    "భరత యుద్ధమందు రథకేతువైన కపిరాజుని గర్జన విని కౌరవ సేన కలవరపడెను; ద్రోణ భీష్ములు సమీరసుతుని మహా వీరత్వమును గొప్ప బలసాగరమని పలికిరి. కోతుల సహజ బాలక క్రీడ భూమిపై సూర్యుని చేరగా ఆకాశభూములు కలవరపడెను; యోధులు తలలు కొట్టుకొని చూడగా హనుమాన్ జగజీవన ఫలమని తెలిచెను.",
    "గోపద వ్యాప్తి సముద్రమును హోలికవలె లంకను తెచ్చి నిర్భయముగా శత్రు పురమును గెలిచెను; ద్రోణ పర్వతమును ఎత్తి కందుకవలె కపి క్రీడ చేసెను. రామరాజ్యమునకు సంకటము కలిగినప్పుడు కార్యములు చేతితో పూర్తయ్యెను; హనుమాన్ బాహుబలమునకు లోకపాలకులు రక్షకులుగా నిలిచిరి.",
    "ఆమె వీపున గాడలు, కాలువలు—సముద్ర జలము నింపిన పాత్రవలె; రాక్షసులను ఓడించి దుర్గము కలిగెను. కుంభకర్ణ రావణ సముద్రాదుల నిప్పుగా తులసీ ప్రతాపము అగ్నివలె ప్రజ్వలించెను; భీష్ముడు పలికినట్టి హనుమాన్ త్రికాల త్రిలోకమందు మహాబలుడవు.",
    "రామరాయుని దూతవు, వాయువు పుత్రుడవు, అంజనీ నందనుడవు, ప్రభావశాలి సూర్యుని వంటివాడవు; సీత శోకహరణ, దురిత దోష దమన, శరణాగత రక్షణ, లక్ష్మణ ప్రియ ప్రాణ స్వరూపుడవు. రావణుడు దరిద్రుని భయపెట్టినప్పుడు మూడు లోకముల నిధివలె ప్రకటితుడవయ్యె; జ్ఞాన గుణవాన్, బలవాన్, సేవకునకు సావధానుడై హనుమాన్ హృదయమున ప్రవేశించుము.",
    "శత్రు దళములను భూలోకమందు విఖ్యాత బలముతో నాశనము చేయువాడవు; పాప తాప అంధకారములను తొలగించు సేవక పద్మములకు సుఖదాయక సూర్యోదయుడవు. లోక పరలోకములందు శోకము లేని నమ్మకము తులసీ హృదయమందు నీపైనే; రాముని ప్రియ దాసుడవు, బామదేవుని వాసస్థానము, కలియుగ కామధేనువైన కేసరీ కుమారుడవు.",
    "మహాబల సీమ, మహాభీమ, మహా బాణ యంత్రధారి, మహా వీరుడవు—రఘువీరుని కీర్తిని వ్యాపింపజేసినవాడవు. వజ్ర కఠిన శరీరము, యుద్ధమందు రౌద్రము, కరుణామయ ధర్మధీర హృదయము. దుర్జనులకు కాలము, సజ్జనులకు రక్షకుడవు—తులసీ బాధలను తొలగించుటకు స్మరింపబడుదువు. సీత సుఖదాయక, రఘునాయకుని ప్రియుడవు, సాహసి సమీరుని సహాయకుడవు.",
    "బ్రహ్మవంటి సృష్టించుట, విష్ణువంటి పోషించుట, శివునివలె నాశనము, అమృతము పానము చేయుట—అన్నీ నీవే. భూమిని ధరించుట, సముద్రమును తరించుట, సూర్యచంద్రులను పోషించుట—నీ సామర్థ్యమే. శత్రు దుఃఖ కారకుడవు, జనులను సంతోషింపజేయువాడవు; మలినతను తొలగించు మోదక దానము. మూడు పురములలో ఆర్తిని తొలగించు తులసీ ప్రభువు నీవే—హనుమాన్ దృఢ స్వభావుడవు.",
    "జానకీశ్వరుని సేవకుని మనోభావము తెలిసి సానుకూల శూలపాణి దేవతలను నమస్కరించు నాథుని వద్దకు. దేవతలు రాక్షసులు కరుణతో చేతులు జోడించిరి; రాజుల బలము ఏమిటో తెలియజేసెను. జాగృత స్వప్న సుఖములందు అనర్థమునకు ఒకే చూపు గలవాడవు; ఎవరు హృదయమందు హనుమాన్ నమ్మకముంచుదురో వారికి రోజులు శుభమగును.",
    "గౌరీ సహిత సానుకూల శూలధారి నీకు; లోకపాలకులందరు లక్ష్మణ రామ సీతలతో కూడిన వారవు. మూడు లోకముల శోకము నీకు లేదు—తులసీకి ఇతర వీరులెవరో తెలియదు. కేసరీ కుమార బందీఛోరుని సేవకులందరు నీ నిర్మల కీర్తిని స్తుతించుదురు; ఋషులు బాలుని వలె పోషించుదురు—నీ హనుమాన్ నాదమునకు హృదయము ఆనందించును.",
    "కరుణా నిధి, బలబుద్ధి నిధి, మోద మహిమ నిధి, గుణ జ్ఞాన నిధివి. బామదేవ రూపి, రామభూపాలుని స్నేహితుడవు—నామ స్మరణతో అర్థ ధర్మ కామములు నెరవేరును. సీతానాథుని శీల ప్రభావము నీవే; లోక వేద విధులకు విద్వాంసుడవు. మనస్సు, వాక్కు, కర్మల మూడు విధములతో తులసీకి నీవే ప్రభువు—సుజ్ఞానుడవు.",
    "మనస్సునకు అగమ్యమైన కార్యమును శరీరమున సులభముగా చేసిన కపీశ్వరుడవు—మహారాజు సభలో సభను సజ్జం చేసినావు. దేవ బందీఛోర కేసరీ కుమారా, యుగయుగముల జగత్తున నీ కీర్తి వ్యాపించును. తులసీ పక్షమున విని సాధువులు సంతోశించి శత్రువులు వణకుదురు. అంజనీ కుమారా, నాకు కలిగిన దోషమును సరిదిద్దుము—హనుమాన్ కృప వలెనే జరుగును.",
    "జ్ఞాన శిఖామణివై హనుమా, జనుల హృదయమందు నిత్య నివసించుము. నేను ఎవరిని కోపించుదునో నీకు తెలియును—నీవే నాకు ఆధారము. ప్రభు సేవక సంబంధమున చేసినది నాకు చెడదు. దోషము చూపువారికి ముందుగా జాగ్రత్త—లేనిచో హృదయము ఓడిపోవును.",
    "శివుని కూడా నీవు కదలించగలవు; నీవు స్థిరపరచిన కపి యే ఇంటినైనా కూల్చగలడు. నీ కృపతో దీనులు శత్రువుల హృదయములందు విరాజిల్లుదురు. సంకట శోకములు నామ స్మరణతో జాలమువలె చీల్చబడును; వృద్ధులు బలివంటివారు నా విషయమై ఎన్నో వినతులు చేసిరి.",
    "సముద్రము దాటి, శత్రు వీరులను జయించి, లంకను కాల్చి భంకరముగా తిరిగివచ్చినావు. యుద్ధ సింహమువలె శత్రు కుంజరములను చీల్చినావు. అట్టి సామర్థ్యము గల ప్రభువు తులసీ బాధలను తొలగించగలడు; కోతుల బలము పెరిగిన శత్రువులను ఎందుకు లవణమువలె చుట్టివేయకూడదు.",
    "అశోక వనమున దశాననుని ముఖమును చూడలేని భంకితి కలిగెను. మేఘనాదాది అకంపన కుంభకర్ణుల వంటి యుద్ధ హస్తులను జయించినావు. రామ ప్రతాప అగ్ని, సచ్ఛ పచ్ఛ సమీర స్వరూపుడవు. పాప, సర్ప, తాపములను తులసీ నుండి ఎల్లప్పుడూ రక్షించువాడవు.",
    "జగత్తు హనుమాన్ కృపను తెలిసినవారు మనస్సున అనుమానించి మాట తప్పకూడదు. తులసీ సేవ యోగ్యుడవు—ప్రభు స్వభావమును కపి రక్షించుము. అపరాధిని వేల విధముల శాసన చేయినా, మోదక మరణించిన వానిని మాహుర్ వేయకూడదు. సాహసి సమీరుని ప్రియ రఘువీరుని బాహు వేదనను మహా వీరుడవు వేగముగా తొలగించుము.",
    "బాలుని చూచి బలివంటి వానితో స్నేహము చేసిన దీనబంధువు అపార కరుణ చూపెను. తులసీపై నమ్మకము, బలము, ఆశ, దాసభావము—రాముని యోచన. కలికాలము భయంకరము—బలిశుని తలపై పాదముంచి చూడి తొలగించుము. కేసరీ కుమారా, రణరోర, బాహు వేదనను రాహు మాతృవలె తొలగించుము.",
    "కదలించువాడు స్థిరపరచువాడు—కేసరీ కుమారుడా, నీ బలమును సంభరించుము. రాముని దాసులకు కామధేనువైన రామదూతా, దీన దుబలునికి నీవే ఆధారము. సామర్థ్యము గల ప్రభువు తులసీ తలపై అపరాధము లేకుండా కట్టి కొట్టకూడదు. విశాల బాహువులు—శత్రు వేదనను మకరివలె పట్టి ముఖము చీల్చుము.",
    "రామ స్నేహము, రామ సాహసము, లక్ష్మణ సీతలు, రామ భక్తి—సంకట శోకములను తొలగించుము. మూఢ మరకట రోగ సాగరమును చూచి జాంబవంతుని వంటి జీవులు నీపై నమ్మకముంచుదురు. కృపతో తులసీని ప్రేమపంచనతో ఎత్తి సుస్థితముగా కూర్చోబెట్టి ఆలోచించుము. మహా వీరా, లంకినీవలె లాత ఘాతములతో బాహు వేదనను మరోరి మార్చుము.",
    "మూడు లోకములు చూడని నీవు నాలుగు దిక్కులను చూడగలవు; కర్మ, కాల, లోకపాలకులు, అగ్ని జల జీవజాలములు—నీ మహిమను తెలుసుకొందురు. రాముని ప్రత్యేక దాసుడను నీవు, నీవాసము వారి హృదయమందు—తులసీ ఆ దేవుని బాధ చూడలేకున్నాను. వృక్మూల బాహుశూల కపి కచ్ఛు బెల్లు—కపి క్రీయతోనే ఉప్పెను తొలగించగలవు.",
    "కంస వంటి క్రూర భూమిపాలకుల భరోసాపై బకాసుర బక సోదరి ఎవరిని భయపెట్టును. బాలఘాతిని చెప్పలేనంత భయంకరి—బాలుని బాహుబలము చిన్నవారిని తరిమెను. స్వయమే వేషము ధరించి చూడి పాపములు గుణవంతుల పాలకు పడును. పూతన వంటి పిశాచిని కపి కాన్హ తులసీ బాహు వేదనకు నీవే మార్గము—మహా వీరుడవు.",
    "భాల, కాల, క్రోధ, త్రిదోషముల వలన కలిగిన విషమ వేదన, పాప తాప ఛలములు. కర్మ కూటికి జంత్ర మంత్ర బూటికి మలిన మనస్సు పాపిని బాధించును. శాంతి చేయి, నతులను కొట్టకూడదు—కపి నామము తెలిసి మూఢత్వము వదలు. హనుమాన్ ప్రమాణము, మహా వీర ప్రతిజ్ఞ—బాహు వేదన గలవారికి రక్ష.",
    "సింహికను సంహరించి, సురసను ఛలము సరిచేసి, లంకినిని త్రోసి ఉద్యానవనమును శుభ్రము చేసినావు. లంకను కాల్చి మకరిని చీల్చి రాక్షసులను ధూళి చేసినావు. జమకాతర, మదోదర, రావణ రాణి, మేఘనాదులను త్రోసినావు. బాహు వేదనను మహా వీరుడవు నిర్మూలించినావు—తులసీ శోకము భారమైనది.",
    "నీ బాలక క్రీడ వీరత్వము విని ధీరులు శరీర స్మృతిని మరచిరి—ఇంద్ర సూర్య రాహుల వంటి. నీ బాహువు నివసించగా లోకపాలకులందరు శోకము లేక యుందురు; నీ నామము జపించగా ఆర్తి లేదు. సామ దాన భేద బిధి వేద లబేద సిద్ధి—కపినాథుని చేతిలోనే. ఆలస్య ద్వేష పరిహాసములతో నేర్పు—ఇన్నాళ్లు తులసీ బాహు వేదన కలిగెను.",
    "దీనులు ఇంటింట తిరుగుచున్నారు—బాలుని వలె కృపతో పాలించి పోషించుము. అంజనీ కుమార వీరుడా, సారమును గ్రహించి నా నమ్మకము వదలకుము. ఇంతటి సామర్థ్యము గల కపిరాజా, మూడు లోకములు నీకే సాక్షి. దాసుని శాసన సహించి పరిహాసము చూడి—చీరిన చావు బాలకుని ఆటవలె చూడుము.",
    "స్వయమే పాప త్రితాప సర్ప వలన బాహు వేదన పెరిగి సహింప శక్యము కాదు. ఔషధ జంత్ర టోటకములు చేసి దేవతలను మరింత ప్రార్థించినాను. కర్త, భర్త, హర్త, కర్మ, కాల—జగజాలమందు ఎవరు నీ మహిమను మానరు. తులసీ నీ దాసుడను, నీవు నా ప్రభువు రామదూత—వీరా, నా బాధ నిన్ను కలచుచున్నది.",
    "రామరాయుని దూత, వాయువు పుత్రుడవు, హస్త పాద సామర్థ్యము గల సహాయకుడవు అసహాయులకు. విశిష్ట కీర్తి వేదములచే గానమగునది; రావణునితో యుద్ధమందు ముష్టి ఘాతమిచ్చినావు. ఇంతటి మహా ప్రభువును ఈ రోజు కృపించి సేవకుని వాక్కు మనస్సు కాయములను అంగీకరించుము. చిన్న బాహు వేదన తులసీకి గొప్ప వ్యథ—పాప కోప లోప ప్రకట ప్రభావము ఏమిటో.",
    "దేవతలు, దానవులు, మనుష్యులు, మునులు, సిద్ధ నాగులు—చిన్న పెద్ద చేతనాచేతన జీవులు. పూతన పిశాచి రాక్షసులు రామదూతుని రజస్సును శిరస్సున ధరించుదురు. ఘోర జంత్ర మంత్ర కూట కపట రోగ యోగులు హనుమాన్ నామము వినగా నివాసము వదులుదురు. క్రోధము కర్మకు, బోధ తులసీకు, శోధ దోష దుఃఖ దాతలకు చేయుము.",
    "నీ బలముతో కోతులు రావణునితో యుద్ధమందు గెలిచినవి; నీ బలముతో రాక్షసులు ఇంటింట పారిపోయినారు. నీ బలముతో రామరాజ్యము, దేవకార్యములు, రఘువీరుని సమాజము సజ్జమయ్యెను. నీ గుణగానము విని బ్రహ్మ విష్ణు శివుల కన్నులు జలమయమగును. తులసీ తలపై చేయి వేయి కపినాథా—దాసుని దుఃఖము నీకు కనబడదా.",
    "నీ భిక్షను పోషించి తప్పు మూగత్వము రానియ్యకుము; నేను నీ వైపు చూచుచున్నాను. భోరానాథా, చిన్న దోషమునకు కోపించక, పోషించి స్థిరపరచి నన్ను వదలకుము. నీవు జలము, నీవు అంబరము, నీవు ఆకాశము—నా నీ ఆధారముల మధ్య విలంబము తెలుసుకొనుము. బాలుని వ్యాకులత తెలిసి ప్రేమతో గ్రహించి తులసీ బాహువులపై చేయి తిప్పుము.",
    "రోగ కుజోగ కులోగములు రాత్రి మేఘములవలె చుట్టుకొనినవి; వర్షము వేదనను జ్వరము వలె తొలగించుము—కోపము లేక దోషము, ధూమ మూల మలినత. కరుణానిధాన హనుమాన్ మహా బలవాన్—చూచి నవ్వి హూంకరించి ఫూంకి శత్రు సైన్యమును గాలికి తొలగించినావు. తులసీ కురోగ రాక్షసిని మింగి కేసరీ కుమార వీరుడవు కాపాడినావు.",
    "రామ దాసుడవు నీవే హనుమాన్—గోసాయి సుసాయి సదా అనుకూలుడవు. తల్లిదండ్రుల వలె బాలుని పోషించినావు—మంగళ మోద సమూహముతో. బాహు వేదన బాహు పగారునకు పిలుచుచున్న ఆర్తి ఆనందమును మరచకుము. శ్రీ రఘువీరుడు పీడను తొలగించును—నేను దర్బారున అడ్డుపడి లొల్లి చేయుదును.",
    "కాల క్రూరత, కర్మ కఠినత, పాప ప్రభావముల వలన మూఢుడనైనాను. విషమ వేదన రాత్రి పగలు సహింప శక్యము కాదు—సమీర డావరే బాహువు పట్టుకొన్నాడు. తులసీ నీవు తెచ్చిన వృక్షమును చూచి నీటితో పోయి మూడు లోకములు శుభ్రమయ్యెను. భూత స్వంత పరుల కృపానిధి—రామ రావరి రీతులు అందరికీ తెలియును.",
    "పాద, పెట్ట, బాహు, నోట వేదన—మొత్తం శరీరము వేదనతో నిశ్శలము. దేవ భూత పితృ కర్మ శత్రు కాల గ్రహములు నన్ను ఒత్తిరి. నేను మోలకు అమ్మబడిన వస్తువు—రామ నామ రక్ష లలాటమున లిఖించుకొన్నాను. కుంభజుని సేవకులు గోఖురున విలపించినట్టు రామరాయా, ఇట్టి దశ నాది.",
    "బాహుక సుబాహు నీచ లీచర మరీచుల కూటము—నోట వేదన, కేతు జనిత కురోగ, రాక్షసత్వము. రామ నామ జప జాగరణ చేసిన చోట కాల దూత భూతము నా మాట ఏమిటి. రామ లక్ష్మణుల రెండు అక్షరములను స్మరించుము—వారి సమూహము జగత్తును కాపాడును. తులసీ తాడకను సంహరించి వృక్షమును బద్దలు చేసిన భటుడవు—బాణవానము నిర్మించినావు.",
    "బాల్యమందు మనస్సు రాముని ఎదుట శుద్ధమైనది; రామ నామము తీసి భిక్ష భోజనము చేసినాను. లోక రీతులందు రామరాయుని పవిత్ర ప్రేమ—మోహముతో తర్క తర్కములు. చెడు ఆచారములను అంజనీ కుమారా రామ పాద పద్మమున శుద్ధి చేసినాను. తులసీ గోసాయి అయినాను—మూఢ దినములు మరచిపోయినాను—ఫలము చివరకు పరిపక్వమగును.",
    "ఆహార వస్త్ర రహితుడను, విషమ విషాదమున మునిగినవాడను—దీనుడను చూచి హాహాకారము చేయని వాడను. తులసీని అనాథను రఘునాథుడు సనాథుని చేసెను—శీల సింధువై స్వభావ ఫలమిచ్చెను. నీచుని మధ్య పతిని పొంది భర్త హరించిన—భజన వదలి వాక్కు మనస్సు కాయములు. తండ్రి శరీరమును ఘోర బరుతోర్ తో నలిపి—రామరాయుని లవణము పొట్టు నుండి వచ్చునట్టు.",
    "జగత్తు జానకీ జీవనుడని పేరు గలవాడు, బారాహ సరస్సు నీటిలో మరణించబోయినవాడు. తులసీ రెండు చేతులు మోదకములవలె—జీవించినా చనిపోయినా శోకము లేని బాలుడు. నన్ను అబద్ధమని నిజమని జనులు రాముని గురించి చెప్పుదురు—నా మనస్సు హరిని తప్ప ఇతరులను మానదు. భారీ వేదన శరీరమున విహ్వలుడనై రఘువీరుని తప్ప దూరము చేయలేను.",
    "సీతాపతి ప్రభు సహాయకుడవు హనుమాన్—శివుని వలె ఉపదేశకుడు గురువు. మనస్సు వాక్కు కాయములు నీ పాద శరణము; దేవతలను నేను నీ కంటే యెరుగను. వ్యాధి భూతజనిత ఉపాధి ఏ శత్రువు—తులసీని జనులు తెలిసి శాంతి చేయుము. కపినాథ రఘునాథ భూలానాథ భూతనాథ—రోగ సముద్రమును గాయ ఖురకై వేయకూడదా.",
    "హనుమాన్, రామరాయ, శంకర కృపానిధుల సావధానముతో వినుడి. హర్ష శోక రాగ క్రోధ గుణ దోషములతో బ్రహ్మ సృష్టించిన లోకము. మాయ జీవ కాల కర్మ స్వభావముల—రాముడు వేదములను సత్యమని మనస్సున గణింపుము. నీవు చెప్పినది కాదని బాధ కలుగదని నాకు తెలియజేయుము; నేను మౌనముగా ఉండినా అర్థము తెలుసుకొనుము.",
]

ME_EN = [
    "You crossed the ocean, dispelled Sita’s sorrow, and swallowed the child-sun; vast arms, fierce form—Death’s own death. You burned Lanka yet left it unconsumed; You crush demon pride, O wind-born hero. Tulsidas says You are easy to serve: remembering, bowing, meditating, reciting You—every bitter trouble ends.",
    "Like golden mountains, like a billion young suns in splendour; broad chest, thunderbolt arms and nails. Red eyes, fierce brow, four-faced mouth; lord of monkeys, tail like a langur—You scorch enemy hosts. Whoever holds Maruti’s fierce form in the heart—neither affliction nor sin draws near, even in dreams.",
    "Five faces, six, Bhrigu’s head—You rout demon and god armies in every battle; crooked-bodied hero, famed in Vedas as Paishapur. Raghunath praises Your virtues; with Your strength the world-ocean sways. Who rivals You, Tulsidas, in crushing foes—wind’s son, Raghu’s son, fierce hero?",
    "Seeing the sun, child Hanuman leapt skyward—play innocent yet sure. Gods marvelled; strength, heroism, courage, patience—Tulsidas, You bore all excellence in one body.",
    "At Bharata’s war-flag the monkey king’s roar shook the Kuru host; Drona and Bhishma called the wind-son an ocean of valour. Monkeys’ child-play with the sun shook heaven and earth; warriors watched—Hanuman showed the fruit of worldly life.",
    "You brought Lanka like Holi across the cow’s milk-ocean, fearless, crushing the foe-city. You uprooted Drona’s hill like a ball in sport; Rama’s work was done in a moment; by Your arm even guardians stood firm again.",
    "Like a turtle’s back and tortoise lines—ocean-water filled to measure; demons fled, fortresses fell. Your glory burned Kumbhakarna, Ravana, ocean-fuel—Tulsidas, Bhishma said Hanuman matches none in strength in the three worlds and three times.",
    "Rama’s messenger, wind’s true son, Anjani’s child, splendour like the sun; You end Sita’s grief, sin’s stain, protect refugees—Lakshmana’s dear life. When ten-faced one terrified the poor, You stood revealed as triple-world’s treasure; wise, virtuous, strong, attentive—enter the heart, Hanuman.",
    "You destroy hostile hosts, famed in earth and heaven; Vedas sing You, foe of bondage—dawn that ends sin’s night. No grief in this world or next for those who trust You, Tulsidas; Rama’s darling, Bhamadeva’s abode, Kali’s wish-tree youth, Kesari’s son.",
    "Limitless might, terror to foes, great archer—You spread Raghuvir’s fame. Thunderbolt body in war, yet mercy in a righteous heart; death to wicked, shield to good—remembering You removes Tulsidas’s pain. Sita’s joy, Raghu-nath’s darling, bold wind’s helper.",
    "Creator like Brahma, sustainer like Vishnu, destroyer like Shiva, drinker of nectar; bearer of earth, crosser of seas, burner and cherisher of sun and moon. You harm the wicked, delight the good; purity’s joy-gift; in all three cities You end the supplicant’s woe—Tulsidas’s lord, steadfast Hanuman.",
    "Knowing Janaki’s lord’s servant’s mind, gods with tridents bow to the Master; demons join hands in mercy. Awake, asleep, sitting, walking—whoever harms one under Your gaze perishes; all days prosper for those whose hearts trust Hanuman’s call.",
    "Shiva-with-Gauri favours the trident-bearer; all guardians with Lakshmana, Rama, Sita. Triple-world’s grief is gone for him, Tulsidas—what other hero? Kesari’s son, bond-breaker’s servant—all praise the pure fame of the compassion-sea monkey; sages nurture him like a child—hearts thrill at Hanuman’s roar.",
    "Ocean of mercy, of strength and wit, of joy and glory, of virtue and knowledge; Bhamadeva’s form, king Rama’s friend—Your name grants wealth, dharma, desire’s end. Sitanath’s grace is Yours; knower of world and Veda. Mind, speech, deed—in all three ways, Tulsidas, You alone are the wise Lord.",
    "You made the mind’s impossible easy in body, O monkey-king—arrayed the great king’s court. Bond-breaker, battlefield-roarer, Kesari’s son—age to age Your fame shines. Heroes rejoice, villains tremble hearing Tulsidas’s plea; Anjani’s son, mend my fault—as when Hanuman’s grace mends all.",
    "Crest-jewel of wisdom, Hanuman, ever dwell in people’s hearts. Whom should I blame in anger—you know; master-servant bond—what You do cannot harm Tulsidas. Warn those who fault me—else the heart is lost.",
    "You shake even Shiva; the monkey You steady razes any house. By Your grace paupers shine in enemies’ hearts; sorrows snap like cobwebs; elders like Bali pleaded long for me.",
    "You crossed the sea, crushed mighty foes, burned Lanka and returned in glory; in war like lions You tore enemy elephants. Such a lord can bear Tulsidas’s pain; why should monkey strength not coil foes like salt?",
    "Ashoka grove shamed Ravana’s face; you broke thunder-like Kumbhakarna and elephant-warriors; You are Rama’s fire, wind that fans good and burns evil—Tulsidas’s guard from sin, serpent, and fever always.",
    "World knows Hanuman’s grace—mind him, Bali, forget not speech. Tulsidas is fit to serve—lord of monkeys, uphold honour. Punish the guilty thousandfold, yet slay not the modaka-offerer. Raghuvir’s darling wind-son, great hero, quickly end this arm’s pain.",
    "Seeing the child, Bali, You befriended him—Lord of the poor showed boundless mercy. Tulsidas’s trust, strength, hope, service—think, O Rama’s slave. Kali is terrible—none soothed it; set foot on Bali’s head and end it. Kesari’s son, war-roarer, hero—tear arm-pain like Rahu’s mother.",
    "Mover and stabilizer—Kesari’s son, rally Your strength. Rama’s slaves’ wish-tree, Rama’s envoy—support this poor weak one. Mighty lord, bind not guiltless Tulsidas and strike; vast arms—tear the water-demon’s pain like a spider’s face.",
    "Rama’s love, Rama’s courage with Lakshmana and Sita, Rama’s bhakti—end grief and trouble. Fools and apes, disease-ocean despair—Jambavan’s life trusted Your weight. Lift Tulsidas with love’s swing, seat him firm; great hero, why not crush arm-pain like Lanka’s kick?",
    "You who see not the three worlds yet scan all four ways—karma, time, guardians, fire, water, beings—know each hand’s glory. Rama’s own servant, You dwell in his heart—Tulsidas sees that god in pain. Root-strike, arm-spear, monkey’s creeper—uproot the creeper of monkey tricks.",
    "On cruel Kamsa-like kings’ strength—would Bakasura’s sister frighten anyone? Terrible child-slayer—yet a child’s arm drove the small away. She came in disguise—sin falls on the noble’s neck. Like Putana for Tulsidas’s monkey-child—arm-pain, great hero, dies at Your blow.",
    "Pain from forehead, time, wrath, the three doshas—bitter ache of sin’s deceit. Karma’s knot, spells, charms—sinful mind’s stain. Grant peace; strike not the humble who know monkey-names. Hanuman’s oath, hero’s vow—protect those with arm-pain.",
    "You killed Simhika, mended Surasa’s trick, struck Lanka’s guard, cleared the grove; burned Lanka, tore the crocodile, dusted demons; threw Jamavanta’s foes, Ravana’s queen, Meghanad; kept arm-pain at bay—Tulsidas’s worry weighs heavy.",
    "Hearing Your childlike play, sages forgot body like Indra-Sun-Rahu; under Your arm all guardians are free of grief; Your name removes all ritual lack. Counsel, charity, force, Veda, success—all rest in Kapinath’s hand. Teach through jest and slight—so long Tulsidas’s Bahu-pain lasted.",
    "Beggars roam house to house—nourish like a child, O merciful guardian. Anjani’s hero, You grasped the essence—forget not my faith. Such power, monkey-king—three worlds witness truth. Endure the servant’s chastisement, see the jest—death torn is but a child’s game.",
    "Sin, triple-heat, serpent yourself increased arm-pain unbearable; herbs, spells, charms tried, gods propitiated more. Doer, bearer, destroyer, karma, time—who in the web disobeys? Tulsidas is Yours, You are mine, Rama’s envoy—Your slackness, hero, wrings my pain.",
    "Rama’s envoy, wind’s heir, hands and feet of help to the helpless; famed deeds sung in Vedas—you struck Ravana with a fist. Favour this great lord today—accept the good servant’s word, mind, deed. Small arm-pain shames Tulsidas—what sin, wrath, loss of manifest grace?",
    "Gods, demons, men, sages, siddhas, nagas—all beings great and small. Putana, ghosts, rakshasas bow to Ramaduta’s dust on the head. Fierce spells, deceit, bad yoga flee hearing “Hanuman.” Anger at karma, wake Tulsidas, probe those who give pain and grief.",
    "By Your strength monkeys won from Ravana; by Your strength rakshasas fled home; by Your strength Rama’s rule and all deva-works, Raghuvir’s assembly, thrived. Hearing Your praise Brahma-Hari-Hara weep with wet eyes. Stroke Tulsidas’s head, monkey-lord—see not the servant’s grief nearby?",
    "Feed Your beggar—let no fault mute him; I look to You with two poor cowries. Lord of dawn, rage not at small fault—nourish, delight, steady me, delay not. You are water, sky, cloud—understand my refuge in You. Know the child’s distress, embrace Tulsidas’s arms with love.",
    "Ills besieged like night-clouds; rain and drain fever-pain without wrongful wrath. Compassionate mighty Hanuman—laughing, roaring, blowing, You scattered hosts; Tulsidas’s chronic disease-rakshasas eaten, Kesari’s son, hero, kept honour.",
    "You alone are Rama’s slave, Hanuman—Gosayi’s gentle favourite always. You raised me like parents with auspicious joy. Arm-pain’s cry forgets not bliss—may Raghuvir end pain; I roll at court in distress.",
    "Cruel time, hard karma, sin’s sway made me mad; vile pain day and night unbearable—only Wind’s son’s arm grasped. The tree You gave, Tulsidas, watered, cleansed all three worlds. Kind to self and other—Ram and Ravana’s ways are known to all.",
    "Foot, belly, arm, mouth pain—whole body trembles with ache; gods, ghosts, fathers, foes, time, planets press me. I am sold without price—Rama’s name-mark on the forehead. Kumbhaja’s servants drowned in hoof-print—Ramaraya, such is my state.",
    "Bahuk, Subahu, base Marich joined—mouth pain, Ketu-born foul disease, demon-nature. Rama-nama japa and vigil—how can time’s ghosts touch me? Remember Rama-Lakshmana’s two syllables—whose hosts guard the waking world. Tulsidas, raise Tadaka’s slayer, split the tree, build the arrow-machine.",
    "In childhood mind faced Rama pure; lived on Rama-nama alms. World’s ways, pure love of Ram—mired in debate. Wrong habits—Anjani’s son, washed at Rama’s feet. Tulsidas became Gosayi—foolish days forgotten—fruit ripens at last.",
    "Without food or clothes, sunk in strange sorrow—the poor one sighs not aloud. Tulsidas orphaned found Raghu-nath as lord—ocean of grace gave natural fruit. Base in-between, husband gained then lost—left lord’s bhajan, body, speech, mind. Father’s body ground in terrible mortar—salt bursts forth like Ram’s name.",
    "Called world’s life of Janaki, about to drown in Barah’s lake; Tulsidas’s two hands like modak lumps—no child grieves living or dead. Folk call me liar or true about Rama—my mind knows only Hari. Great bodily pain—without Raghuvir I cannot cast it far.",
    "Sita’s lord, master, helper Hanuman daily—take Shiva as counsel-guru. Mind, word, deed at Your feet; I know no god above You. Disease, ghost-obstacle, any foe’s harm—knowing people, give Tulsidas peace. Kapinath, Raghunath, Bholanath, lord of beings—why not sink disease-sea with hoof-splash?",
    "Hear attentively from wise Hanuman, Ramray, merciful Shankar. Joy, sorrow, passion, anger—Brahma made the world with merit and fault. Maya, life, time, karma’s nature—Rama acts, Vedas say true—ponder in mind. Teach me what cannot bring “alas”; I stay silent—read that meaning.",
]

assert len(ME_TE) == 44 and len(ME_EN) == 44

OUT = pathlib.Path(__file__).resolve().parent / "hanuman_bahuk.html"

nav = """    <p class="sibling-nav"><a href="hanuman_chalisa.html">Hanuman Chalisa</a> · <a href="sankata_mochana_hanuman_ashtakam.html">Sankata Mochana Hanuman Ashtakam</a></p>"""

html = ["""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hanuman Bahuk - Goswami Tulsidas</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.45;
            max-width: 900px;
            margin: 0 auto;
            padding: 20px;
            color: #333;
        }
        h1 {
            text-align: center;
            color: #d35400;
            border-bottom: 2px solid #d35400;
            padding-bottom: 10px;
        }
        h2 {
            background-color: #fcece4;
            padding: 10px;
            border-left: 5px solid #d35400;
            margin-top: 28px;
        }
        h3.meter {
            font-size: 1em;
            color: #555;
            margin: 18px 0 8px;
            font-weight: 600;
        }
        .verse-box {
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 14px;
            margin-bottom: 12px;
            background-color: #fff;
            page-break-inside: avoid;
        }
        .scripts {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 18px;
            margin-bottom: 10px;
            border-bottom: 1px dashed #eee;
            padding-bottom: 10px;
        }
        .hindi { font-size: 1.05em; color: #8e44ad; font-weight: bold; }
        .telugu { font-size: 1.05em; color: #2980b9; font-weight: bold; }
        .english { font-style: italic; font-weight: bold; color: #2c3e50; margin-bottom: 6px; font-size: 0.95em; }
        .word-meaning { font-size: 0.88em; color: #555; margin-bottom: 5px; }
        .meaning-block { margin-top: 8px; }
        .telugu-meaning {
            background-color: #f0f7fc;
            padding: 8px;
            border-left: 3px solid #2980b9;
            margin-bottom: 8px;
            font-size: 0.93em;
        }
        .full-meaning { background-color: #f9f9f9; padding: 8px; border-left: 3px solid #27ae60; font-size: 0.93em; }
        @media print {
            body { max-width: 100%; padding: 0; }
            .verse-box { border: 1px solid #ccc; }
        }
        @media (max-width: 700px) {
            .scripts { grid-template-columns: 1fr; }
        }
        .sibling-nav {
            text-align: center;
            margin: 12px 0 20px;
            font-size: 0.95em;
        }
        .sibling-nav a { color: #d35400; font-weight: 600; }
        .intro { text-align: center; color: #444; margin-bottom: 8px; }
    </style>
</head>
<body>
    <h1>Hanuman Bahuk</h1>
    <p class="intro">Forty-four verses by Goswami Tulsidas — Hindi with Telugu script (transliteration), IAST, and Telugu / English meanings.<br><small>Traditional recitation is held to bring relief from severe pain and obstacles. Devanagari lyrics follow <a href="https://stotranidhi.com/hi/hanuman-bahuk-tulasidas-krutam-in-hindi/">Stotra Nidhi</a>; Telugu column is machine-transliterated for reading alongside Hindi.</small></p>
""", nav, """
    <h2>Verses</h2>
"""]

meter_idx = 0
for i, raw_line in enumerate(verses_raw):
    if meter_idx < len(METER_MARKS) and i == METER_MARKS[meter_idx][0]:
        html.append(f'    <h3 class="meter">{METER_MARKS[meter_idx][1]}</h3>\n')
        meter_idx += 1
    body, num = strip_final_marker(raw_line)
    hi_br = format_hindi_br(body.strip()) + "<br>॥ " + num + " ॥"
    te_body = transl_tel(body)
    te_br = format_telugu_br(te_body.strip()) + "<br>॥ " + num_tel(num) + " ॥"
    en_body = transl_en(body)
    en = en_body + " || " + num.translate(DEV_NUM) + " ||"
    # word line: very short
    words = "Epithets of Hanuman, Rama, Sita, Lakshmana, and foes (Ravana, etc.) as in this verse; see IAST line."
    html.append(f"""    <div class="verse-box">
        <strong>Verse {i + 1}</strong> <small>(॥ {num} ॥)</small>
        <div class="scripts">
            <div class="hindi">{hi_br}</div>
            <div class="telugu">{te_br}</div>
        </div>
        <div class="english">{en}</div>
        <div class="word-meaning"><strong>Words:</strong> {words}</div>
        <div class="meaning-block">
            <div class="telugu-meaning"><strong>Telugu meaning:</strong> {ME_TE[i]}</div>
            <div class="full-meaning"><strong>English meaning:</strong> {ME_EN[i]}</div>
        </div>
    </div>
""")

html.append("""    <p style="text-align: center; color: #666; font-size: 0.95em;">॥ इति श्रीगोस्वामितुलसीदास विरचितं श्रीहनुमानबाहुकम् सम्पूर्णम् ॥</p>
</body>
</html>
""")

OUT.write_text("".join(html), encoding="utf-8")
print("Wrote", OUT, "verses", len(verses_raw))