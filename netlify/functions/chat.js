exports.handler = async (event) => {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Le cerveau de Nexa est actif !" })
  };
};
