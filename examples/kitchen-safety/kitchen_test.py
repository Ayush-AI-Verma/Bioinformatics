from typesafe_sdk import Noul, TypeSafeClient

client = TypeSafeClient(api_key="local", base_url="http://localhost:8009", model="kev-latest")

QUESTIONS = {
    "handles_inward": Noul(instructions="Are the pot handles turned inward?"),
    "dry_mitts": Noul(instructions="Are you using dry oven mitts to handle hot cookware?"),
    "stove_off": Noul(instructions="Is the stove turned off when not in use?"),
    "flammables_away": Noul(instructions="Are towels and paper kept away from the burners?"),
    "stable_board": Noul(instructions="Are you cutting on a stable cutting board?"),
    "knives_stored": Noul(instructions="Are knives stored separately rather than left in the sink?"),
    "cut_away": Noul(instructions="Are you cutting away from your body?"),
    "smother_ready": Noul(instructions="Is a lid or baking soda within reach in case of a grease fire?"),
    "staying": Noul(instructions="Are you staying in the kitchen while food cooks?"),
    "clothing_tied": Noul(instructions="Is loose clothing and long hair tied back?"),
    "smoke_detector": Noul(instructions="Is the smoke detector working?"),
    "hands_washed": Noul(instructions="Did you wash your hands before cooking?"),
    "raw_separate": Noul(instructions="Are raw meats kept separate from ready-to-eat food?"),
    "separate_board": Noul(instructions="Are you using a different cutting board for raw meat?"),
    "fridge_2h": Noul(instructions="Will leftovers be refrigerated within 2 hours?"),
    "spills_wiped": Noul(instructions="Have spills been wiped up right away?"),
    "cords_away": Noul(instructions="Are electrical cords kept away from water and hot surfaces?"),
    "kids_pets_out": Noul(instructions="Are children and pets kept out of the cooking area?"),
    "floor_dry": Noul(instructions="Is the floor dry and free of tripping hazards?"),
    "extinguisher_known": Noul(instructions="Do you know where the fire extinguisher is?"),
}

SCENARIOS = {
    "careful_cook": (
        "Maria washes her hands, ties her hair back, and starts cooking pasta. "
        "She turns the pot handles inward, keeps a lid next to the stove, and uses "
        "a stable wooden cutting board to chop vegetables, cutting away from herself. "
        "Her toddler is playing in the living room. She wipes up a splash of water "
        "on the floor right away and stays at the stove while it simmers."
    ),
    "risky_cook": (
        "Jake throws a pan of oil on high heat, then walks into the garage to grab a beer "
        "while it heats up. His sleeves are loose, a dish towel is draped over the stove "
        "handle, and his 4-year-old is playing on the kitchen floor. Earlier he dropped a "
        "knife into the soapy sink and left it there. There's a wet spill by the fridge "
        "he plans to clean 'later'."
    ),
    "ambiguous": (
        "Sam is making a salad. They washed the lettuce, used a small paring knife on a "
        "glass plate, and put chicken in the fridge. They think the smoke detector battery "
        "might have died last month but aren't sure."
    ),
}

for name, text in SCENARIOS.items():
    result = client.system_one(text, QUESTIONS)
    print(f"\n=== {name} ===")
    for key, noul in result.nouls.items():
        print(f"  {key:20s} {noul.noul:.2f}")
