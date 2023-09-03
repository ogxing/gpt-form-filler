from llama_index import VectorStoreIndex, SimpleDirectoryReader, StorageContext, ServiceContext, load_index_from_storage
from llama_index.output_parsers import GuardrailsOutputParser
from llama_index.llm_predictor import StructuredLLMPredictor
from llama_index.prompts.default_prompts import DEFAULT_TEXT_QA_PROMPT_TMPL, DEFAULT_REFINE_PROMPT_TMPL
from llama_index.prompts import PromptTemplate

from llama_index.output_parsers import LangchainOutputParser
from langchain.output_parsers import StructuredOutputParser, ResponseSchema

import os
import openai

import logging
import sys

logging.basicConfig(stream=sys.stdout, level=logging.DEBUG)
logging.getLogger().addHandler(logging.StreamHandler(stream=sys.stdout))

openai.api_key = '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'

current_script_dir = os.path.dirname(os.path.abspath(__file__))
root_path = os.path.abspath(os.path.join(current_script_dir, '..'))
document_directory =os.path.join(root_path, 'data', 'ocr-sample')

documents = SimpleDirectoryReader(document_directory).load_data()
llm_predictor = StructuredLLMPredictor()

# Load index from cache
# storage_context = StorageContext.from_defaults(persist_dir="./storage")
# index = load_index_from_storage(storage_context)

# Generate index from scratch
index = VectorStoreIndex.from_documents(documents)
index.storage_context.persist()

# Setup guardrails schema to validate output.
# rail_spec = ("""
# <rail version="0.1">

# <output>
#     <object>
#         <string name="name" description="Name of the deceased" format="one-line" on-fail-one-line="noop" />
#         <string name="address" description="Home address of the deceased" format="one-line" on-fail-one-line="noop" />
#         <string name="age" description="Age of the deceased" format="one-line" on-fail-one-line="noop" />
#         <string name="maritial_status" description="Maritial status of the deceased" format="one-line" on-fail-one-line="noop" />
#         <string name="occupation" description="Occupation of the deceased" format="one-line" on-fail-one-line="noop" />
#         <string name="identity_card" description="Identity card number of the deceased" format="one-line" on-fail-one-line="noop" />
#         <string name="date_of_death" description="Date of death of the deceased" format="one-line" on-fail-one-line="noop" />
#         <string name="will_written_at" description="Date of will written" format="one-line" on-fail-one-line="noop" />
#         <string name="domicile" description="Domicile of the deceased" format="one-line" on-fail-one-line="noop" />
#         <string name="deceased_made_and_executed_will_in_the_name_of" description="Deceased made and executed will in the name of" format="one-line" on-fail-one-line="noop" />
#         <string name="deceased_held_assets_in_the_alias_of" description="Deceased held assets in the alias of" format="one-line" on-fail-one-line="noop" />
#     </object>
# </output>

# <prompt>

# Query string here.

# @xml_prefix_prompt

# {output_schema}

# @json_suffix_prompt_v2_wo_none
# </prompt>
# </rail>
# """)

rail_spec = ("""
<rail version="0.1">

<output>
    <list name="points" description="Bullet points regarding events in the author's life.">
        <object>
            <string name="explanation" />
            <string name="explanation2" />
            <string name="explanation3" />
        </object>
    </list>
</output>

<prompt>

Query string here.

@xml_prefix_prompt


@json_suffix_prompt_v2_wo_none
</prompt>
</rail>
""")


# https://gpt-index.readthedocs.io/en/latest/core_modules/query_modules/structured_outputs/output_parser.html
# output_parser = GuardrailsOutputParser.from_rail_string(rail_spec, llm=llm_predictor.llm)

# fmt_qa_tmpl = output_parser.format(DEFAULT_TEXT_QA_PROMPT_TMPL)
# fmt_refine_tmpl = output_parser.format(DEFAULT_REFINE_PROMPT_TMPL)

# qa_prompt = PromptTemplate(fmt_qa_tmpl, output_parser=output_parser)
# refine_prompt = PromptTemplate(fmt_refine_tmpl, output_parser=output_parser)


# query_engine = index.as_query_engine(
#     service_context=ServiceContext.from_defaults(
#         llm_predictor=llm_predictor
#     ),
#     text_qa_template=qa_prompt, 
#     refine_template=refine_prompt, 
# )

# response = query_engine.query('What is the name of the owner of the bank account?')




response_schemas = [
    ResponseSchema(name="name", description="Name of the deceased"),
    ResponseSchema(name="address", description="Home address of the deceased"),
    ResponseSchema(name="age", description="Age of the deceased"),
    ResponseSchema(name="maritial_status", description="Maritial status of the deceased"),
    ResponseSchema(name="occupation", description="Occupation of the deceased"),
    ResponseSchema(name="identity_card", description="Identity card number of the deceased"),
    ResponseSchema(name="date_of_death", description="Date of death of the deceased"),
    ResponseSchema(name="will_written_at", description="Date of will written"),
    ResponseSchema(name="domicile", description="Domicile of the deceased"),
    ResponseSchema(name="deceased_made_and_executed_will_in_the_name_of", description="Deceased made and executed will in the name of"),
    ResponseSchema(name="deceased_held_assets_in_the_alias_of", description="Deceased held assets in the alias of"),
]

# define output parser
lc_output_parser = StructuredOutputParser.from_response_schemas(response_schemas)
output_parser = LangchainOutputParser(lc_output_parser)

# format each prompt with output parser instructions
fmt_qa_tmpl = output_parser.format(DEFAULT_TEXT_QA_PROMPT_TMPL)
fmt_refine_tmpl = output_parser.format(DEFAULT_REFINE_PROMPT_TMPL)
qa_prompt = PromptTemplate(fmt_qa_tmpl, output_parser=output_parser)
refine_prompt = PromptTemplate(fmt_refine_tmpl, output_parser=output_parser)

# query index
query_engine = index.as_query_engine(
    service_context=ServiceContext.from_defaults(
        llm_predictor=llm_predictor
    ),
    text_qa_template=qa_prompt, 
    refine_template=refine_prompt, 
)
response = query_engine.query(
    "Extract fields according to schema", 
)

print('Final response')
print(response)


# Integrate with langchain extraction chain
